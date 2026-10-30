import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'secret' };
const HIBI = 'https://weakestandstrongest-sketch.github.io';
const calls = [];
globalThis.fetch = async (u, o) => {
  calls.push([String(u), o && String(o.body)]);
  const b = new URLSearchParams(o && o.body);
  if (String(u).includes('/token') && b.get('grant_type') === 'authorization_code') {
    const idt = 'x.' + Buffer.from(JSON.stringify({ email: 'me@example.com' })).toString('base64url') + '.y';
    return Response.json({ access_token: 'AT1', refresh_token: 'RT-SECRET', expires_in: 3600, id_token: idt });
  }
  if (String(u).includes('/token') && b.get('grant_type') === 'refresh_token') return b.get('refresh_token') === 'RT-SECRET' ? Response.json({ access_token: 'AT2', expires_in: 3599 }) : Response.json({ error: 'invalid_grant' }, { status: 400 });
  return new Response('', { status: 200 });
};
const call = (path, init = {}, e = env) => worker.fetch(new Request('https://norikae.example.workers.dev' + path, init), e, { waitUntil() {} });

test('ログイン：Google へ送り、戻ってきたら暗号にした鍵をひび手帳へ返す', async () => {
  const r1 = await call('/hibi-auth/start?ret=' + encodeURIComponent(HIBI + '/day/') + '&s=abc');
  assert.equal(r1.status, 302);
  const g = new URL(r1.headers.get('location'));
  assert.equal(g.origin, 'https://accounts.google.com');
  assert.equal(g.searchParams.get('access_type'), 'offline');
  assert.ok(g.searchParams.get('scope').includes('drive.appdata'));
  const r2 = await call('/hibi-auth/cb?code=C&state=' + g.searchParams.get('state'));
  const back = new URL(r2.headers.get('location'));
  assert.equal(back.origin + back.pathname, HIBI + '/day/');
  const h = new URLSearchParams(back.hash.slice(1));
  assert.equal(h.get('s'), 'abc');
  const p = JSON.parse(Buffer.from(h.get('gauth'), 'base64url').toString());
  assert.equal(p.email, 'me@example.com'); assert.equal(p.at, 'AT1');
  assert.ok(!r2.headers.get('location').includes('RT-SECRET'), 'the long-lived key never travels in the clear');
  // その鍵で、短い鍵をもらえる
  const r3 = await call('/hibi-auth/token', { method: 'POST', headers: { origin: HIBI, 'content-type': 'application/json' }, body: JSON.stringify({ rt: p.rt }) });
  assert.equal(r3.status, 200); assert.equal((await r3.json()).at, 'AT2');
  assert.equal(r3.headers.get('access-control-allow-origin'), HIBI);
  // ほかのサイトからは使えない
  const r4 = await call('/hibi-auth/token', { method: 'POST', headers: { origin: 'https://evil.github.io' }, body: JSON.stringify({ rt: p.rt }) });
  assert.equal(r4.status, 403);
  // 別の秘密で作られた鍵や壊れた鍵は「取り消し」扱い
  const r5 = await call('/hibi-auth/token', { method: 'POST', headers: { origin: HIBI }, body: JSON.stringify({ rt: 'garbage' }) });
  assert.equal(r5.status, 401); assert.equal((await r5.json()).error, 'revoked');
});

test('ほかのサイトへはログインの結果を返さない', async () => {
  const r = await call('/hibi-auth/start?ret=' + encodeURIComponent('https://evil.example.com/'));
  assert.equal(r.status, 400);
});

test('設定がまだのときは、ひび手帳にそう伝える', async () => {
  const r = await call('/hibi-auth/start?ret=' + encodeURIComponent(HIBI + '/day/'), {}, {});
  assert.ok(r.headers.get('location').includes('gauth_err=setup'));
});

test('同じアカウントの home（ie.<同じサブドメイン>.workers.dev）にはログインの結果を返し、ほかの人の ie には返さない', async () => {
  const HOME = 'https://ie.example.workers.dev';
  const r1 = await call('/hibi-auth/start?ret=' + encodeURIComponent(HOME + '/') + '&s=xyz');
  assert.equal(r1.status, 302);
  const g = new URL(r1.headers.get('location'));
  const r2 = await call('/hibi-auth/cb?code=C&state=' + g.searchParams.get('state'));
  assert.equal(new URL(r2.headers.get('location')).origin, HOME);
  const p = JSON.parse(Buffer.from(new URLSearchParams(new URL(r2.headers.get('location')).hash.slice(1)).get('gauth'), 'base64url').toString());
  const r3 = await call('/hibi-auth/token', { method: 'POST', headers: { origin: HOME, 'content-type': 'application/json' }, body: JSON.stringify({ rt: p.rt }) });
  assert.equal(r3.status, 200);
  assert.equal(r3.headers.get('access-control-allow-origin'), HOME);
  const pre = await call('/hibi-auth/token', { method: 'OPTIONS', headers: { origin: HOME } });
  assert.equal(pre.headers.get('access-control-allow-origin'), HOME);

  // ほかの人のサブドメインの ie・似た名前は使えない
  for (const bad of ['https://ie.someone-else.workers.dev', 'https://ie2.example.workers.dev', 'https://ie.example.workers.dev.evil.com']) {
    assert.equal((await call('/hibi-auth/start?ret=' + encodeURIComponent(bad + '/'))).status, 400, bad);
    assert.equal((await call('/hibi-auth/token', { method: 'POST', headers: { origin: bad }, body: JSON.stringify({ rt: p.rt }) })).status, 403, bad);
  }
});
