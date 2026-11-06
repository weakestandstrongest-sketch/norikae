import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endpointOk, cleanTimes, makeVapid, vapidAuth, sendPush, HibiPush, handleHibiPush } from '../src/push.js';

const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

test('endpointOk: Push サービスだけ受け付ける', () => {
  assert.ok(endpointOk('https://web.push.apple.com/QAbc'));
  assert.ok(endpointOk('https://fcm.googleapis.com/fcm/send/x'));
  assert.ok(!endpointOk('https://evil.example.com/x'));
  assert.ok(!endpointOk('http://web.push.apple.com/x'));
  assert.ok(!endpointOk('https://web.push.apple.com:8443/x'));
  assert.ok(!endpointOk('nope'));
  assert.ok(endpointOk('http://localhost:9/x', { PUSH_TEST_ORIGIN: 'http://localhost:9' }));
});

test('cleanTimes: 過去・遠すぎる時刻を捨て、分にまるめて重なりを消す', () => {
  const now = Date.UTC(2026, 10, 6, 0, 0);
  const r = cleanTimes([now + 90000, now + 61000, now - 3600000, now + 20 * 86400000, 'x', now + 120000], now);
  assert.deepEqual(r, [now + 60000, now + 120000]);
});

test('vapidAuth: 公開鍵で確かめられる ES256 の JWT', async () => {
  const v = await makeVapid(), now = Date.UTC(2026, 10, 6);
  const h = await vapidAuth('https://web.push.apple.com/abc', v, now);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h); assert.ok(m);
  const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.exp, now / 1000 + 43200);
  assert.match(claims.sub, /^https:\/\//);
  assert.equal(unb64u(m[4]).length, 65);
  const pub = await crypto.subtle.importKey('raw', unb64u(m[4]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`)));
});

test('sendPush: 中身なしで送り、404/410 は gone', async () => {
  const v = await makeVapid(); let seen;
  assert.equal(await sendPush('https://web.push.apple.com/a', v, async (u, init) => { seen = init; return new Response('', { status: 201 }); }), 'ok');
  assert.equal(seen.method, 'POST'); assert.equal(seen.body, undefined); assert.match(seen.headers.authorization, /^vapid t=/);
  assert.equal(await sendPush('https://web.push.apple.com/a', v, async () => new Response('', { status: 410 })), 'gone');
  assert.equal(await sendPush('https://web.push.apple.com/a', v, async () => new Response('', { status: 503 })), 'retry');
  assert.equal(await sendPush('https://web.push.apple.com/a', v, async () => { throw new Error('net'); }), 'retry');
});

// ---- Durable Object を手元で動かす（storage とアラームのまね） ----
function fakeNS() {
  const objs = new Map(), ns = {
    idFromName: (n) => n,
    get: (id) => { if (!objs.has(id)) { const st = fakeState(); objs.set(id, new HibiPush(st, env)); } const o = objs.get(id); return { fetch: (u, init) => o.fetch(new Request(u, init)) }; },
    objs,
  }, env = { HIBI_PUSH: ns };
  return env;
}
function fakeState() {
  const m = new Map(); let alarm = null;
  const storage = {
    get: async (k) => m.get(k),
    put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, b); else m.set(k, v); },
    deleteAll: async () => m.clear(),
    setAlarm: async (t) => { alarm = t; }, deleteAlarm: async () => { alarm = null; }, getAlarm: async () => alarm,
  };
  return { storage, map: m };
}
const req = (path, body, origin = 'https://weakestandstrongest-sketch.github.io') => new Request('https://norikae.example' + path, { method: body ? 'POST' : 'GET', headers: { origin, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test('窓口：鍵・登録・アラームで送る・消す', async () => {
  const env = fakeNS();
  const k = await (await handleHibiPush(req('/hibi-push/key'), env)).json();
  assert.equal(unb64u(k.key).length, 65);
  const k2 = await (await handleHibiPush(req('/hibi-push/key'), env)).json();
  assert.equal(k2.key, k.key, '鍵は一度作ったら同じ');
  assert.equal((await handleHibiPush(req('/hibi-push/key', null, 'https://evil.example'), env)).status, 403);
  assert.equal((await handleHibiPush(req('/hibi-push/sub', { endpoint: 'https://evil.example/x', times: [] }), env)).status, 400);

  const ep = 'https://web.push.apple.com/abc', t1 = Date.now() + 5 * 60000, t2 = Date.now() + 65 * 60000;
  const r = await (await handleHibiPush(req('/hibi-push/sub', { endpoint: ep, times: [t2, t1] }), env)).json();
  assert.equal(r.n, 2);
  const sub = [...env.HIBI_PUSH.objs.entries()].find(([id]) => id.startsWith('s:'))[1];
  assert.equal(await sub.state.storage.getAlarm(), Math.round(t1 / 60000) * 60000);
  // ほかには何も預からない（文はここに来ない）
  assert.deepEqual([...sub.state.map.keys()].sort(), ['endpoint', 'times', 'tries']);

  // 時刻を過ぎたとして alarm を動かす
  const sent = []; sub.fetchFn = async (u) => { sent.push(u); return new Response('', { status: 201 }); };
  sub.state.map.set('times', [Date.now() - 1000, t2]);
  await sub.alarm();
  assert.deepEqual(sent, [ep]);
  assert.deepEqual(sub.state.map.get('times'), [t2]);

  // 宛先がなくなっていたら全部消す
  sub.fetchFn = async () => new Response('', { status: 410 });
  sub.state.map.set('times', [Date.now() - 1000]);
  await sub.alarm();
  assert.equal(sub.state.map.size, 0);

  // 消す
  await handleHibiPush(req('/hibi-push/sub', { endpoint: ep, times: [t1] }), env);
  await handleHibiPush(req('/hibi-push/del', { endpoint: ep }), env);
  assert.equal(sub.state.map.size, 0);
  assert.equal(await sub.state.storage.getAlarm(), null);
});

test('preflight', async () => {
  const r = await handleHibiPush(new Request('https://n/hibi-push/sub', { method: 'OPTIONS', headers: { origin: 'https://weakestandstrongest-sketch.github.io' } }), fakeNS());
  assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), 'https://weakestandstrongest-sketch.github.io');
});
