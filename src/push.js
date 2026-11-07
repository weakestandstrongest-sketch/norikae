// ひび手帳の通知（Web Push）の中継。
// ここが知るのは「通知を鳴らす時刻」と iPhone の通知の宛先だけ。通知の文（予定の名前・課題など）は送られてこない。
// 時刻になったら中身のない Push を送り、iPhone のひび手帳（Service Worker）が自分で持っている文を出す。
// 宛先ごとに 1 つの Durable Object が時刻の一覧を持ち、いちばん近い時刻にアラームをかける。
// VAPID の鍵は、はじめて使うときにここで作って Durable Object（'vapid'）にしまう（設定するシークレットはない）。

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));

// 通知の宛先として受け付けるところ（Apple・Google・Mozilla・Microsoft の Push サービスだけ）
const PUSH_HOSTS = /^(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)$/i;
export function endpointOk(endpoint, env = {}) {
  let u;
  try { u = new URL(String(endpoint || '')); } catch (e) { return false; }
  if (String(endpoint).length > 1024) return false;
  if (env.PUSH_TEST_ORIGIN && u.origin === env.PUSH_TEST_ORIGIN) return true; // テスト用
  return u.protocol === 'https:' && !u.port && PUSH_HOSTS.test(u.hostname);
}

export const MAX_TIMES = 200, AHEAD_MS = 15 * 86400000;
// 受け取った時刻をそろえる：これからの時刻だけ、分にまるめて重なりを消し、古い順に最大 200 個
export function cleanTimes(times, now = Date.now()) {
  const set = new Set();
  for (const t of Array.isArray(times) ? times : []) {
    const n = Math.round(+t / 60000) * 60000;
    if (Number.isFinite(n) && n > now - 60000 && n < now + AHEAD_MS) set.add(n);
  }
  return [...set].sort((a, b) => a - b).slice(0, MAX_TIMES);
}

export async function makeVapid() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { pub: b64u(await crypto.subtle.exportKey('raw', k.publicKey)), jwk: await crypto.subtle.exportKey('jwk', k.privateKey) };
}
const SUB = 'https://weakestandstrongest-sketch.github.io/day/';
export async function vapidAuth(endpoint, vapid, now = Date.now()) {
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: SUB })));
  const key = await crypto.subtle.importKey('jwk', vapid.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`)); // r||s の 64 バイト（JWT の ES256 と同じ形）
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.pub}`;
}
// 中身のない Push を 1 回送る。戻り値：'ok' | 'gone'（宛先がもう無い）| 'retry'
export async function sendPush(endpoint, vapid, fetchFn = fetch) {
  try {
    const res = await fetchFn(endpoint, { method: 'POST', headers: { authorization: await vapidAuth(endpoint, vapid), ttl: '3600', urgency: 'high', 'content-length': '0' } });
    if (res.status === 404 || res.status === 410) return 'gone';
    if (res.status === 403 || res.status === 400) return 'gone'; // 鍵が合わない宛先も、作り直してもらう
    return res.ok ? 'ok' : 'retry';
  } catch (e) { return 'retry'; }
}

// ---------- Durable Object ----------
export class HibiPush {
  constructor(state, env) { this.state = state; this.env = env; this.fetchFn = (...a) => fetch(...a); }
  async vapid() {
    let v = await this.state.storage.get('vapid');
    if (!v) { v = await makeVapid(); await this.state.storage.put('vapid', v); }
    return v;
  }
  async fetch(request) {
    const path = new URL(request.url).pathname, st = this.state.storage;
    if (path === '/vapid') return Response.json(await this.vapid()); // 'vapid' の Object の中だけで使う
    if (path === '/set') {
      const o = await request.json(), times = cleanTimes(o.times);
      if (!times.length) { await st.deleteAll(); await st.deleteAlarm(); return Response.json({ ok: true, n: 0 }); }
      await st.put({ endpoint: o.endpoint, times, tries: 0 });
      await st.setAlarm(times[0]);
      return Response.json({ ok: true, n: times.length, next: times[0] });
    }
    if (path === '/del') { await st.deleteAll(); await st.deleteAlarm(); return Response.json({ ok: true }); }
    return new Response('not found', { status: 404 });
  }
  async alarm() {
    const st = this.state.storage, now = Date.now();
    const endpoint = await st.get('endpoint'), times = (await st.get('times')) || [];
    if (!endpoint || !times.length) { await st.deleteAll(); return; }
    const due = times.filter((t) => t <= now + 30000), rest = times.filter((t) => t > now + 30000);
    if (due.length) {
      const v = await (await this.env.HIBI_PUSH.get(this.env.HIBI_PUSH.idFromName('vapid')).fetch('https://push/vapid')).json();
      const r = await sendPush(endpoint, v, this.fetchFn);
      if (r === 'gone') { await st.deleteAll(); return; }
      if (r === 'retry') {
        const tries = ((await st.get('tries')) || 0) + 1;
        if (tries <= 3) { await st.put('tries', tries); await st.setAlarm(now + 60000 * tries); return; }
      }
      await st.put('tries', 0);
    }
    // 30 分より前に鳴らしそこねた時刻は捨てる（通知が遅れて届くよりよい）
    const next = rest.filter((t) => t > now - 30 * 60000);
    if (!next.length) { await st.deleteAll(); return; }
    await st.put('times', next);
    await st.setAlarm(next[0]);
  }
}

// ---------- 窓口（ひび手帳から呼ぶ） ----------
const ORIGIN = /^https:\/\/weakestandstrongest-sketch\.github\.io$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$|^capacitor:\/\/localhost$/i;
const subId = async (env, endpoint) => env.HIBI_PUSH.idFromName('s:' + b64u(await crypto.subtle.digest('SHA-256', enc.encode(endpoint))));
export async function handleHibiPush(request, env) {
  const origin = request.headers.get('origin') || '', ok = ORIGIN.test(origin);
  const cors = { vary: 'Origin', ...(ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } : {}) };
  const out = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors } });
  if (request.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: cors });
  if (!ok) return out({ error: 'この呼び出し元からは使えません' }, 403);
  if (!env.HIBI_PUSH) return out({ error: '通知の中継がまだ用意されていません' }, 503);
  const path = new URL(request.url).pathname.replace(/^\/hibi-push/, '');
  if (path === '/key' && request.method === 'GET') {
    const v = await (await env.HIBI_PUSH.get(env.HIBI_PUSH.idFromName('vapid')).fetch('https://push/vapid')).json();
    return out({ key: v.pub });
  }
  if (request.method !== 'POST' || (path !== '/sub' && path !== '/del')) return out({ error: 'not found' }, 404);
  let o;
  try { o = await request.json(); } catch (e) { return out({ error: 'bad json' }, 400); }
  const endpoint = o && o.endpoint;
  if (!endpointOk(endpoint, env)) return out({ error: '通知の宛先が正しくありません' }, 400);
  const stub = env.HIBI_PUSH.get(await subId(env, endpoint));
  if (path === '/del') return out(await (await stub.fetch('https://push/del', { method: 'POST' })).json());
  if (!Array.isArray(o.times) || o.times.length > 1000) return out({ error: 'times がありません' }, 400);
  const r = await stub.fetch('https://push/set', { method: 'POST', body: JSON.stringify({ endpoint, times: o.times }) });
  return out(await r.json());
}
