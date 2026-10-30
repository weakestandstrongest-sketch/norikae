// ひび手帳の「Googleドライブに自動保存」のためのログインの窓口
// Google の「クライアント シークレット」は iPhone に置けないので、ここで預かる。
// 長く使える鍵（リフレッシュトークン）は暗号にしてひび手帳に渡し、ここには何も残さない（保存場所を持たない）。
// 必要な設定（Cloudflare のダッシュボード → この Worker → 設定 → 変数とシークレット、種類は「シークレット」）:
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET

// ひび手帳の置き場所だけ（ほかのサイトにはログインの結果を渡さない）
const RET_ORIGIN = /^https:\/\/weakestandstrongest-sketch\.github\.io$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
// 同じ Cloudflare アカウントの home（帰る）アプリ：ie.<同じサブドメイン>.workers.dev だけ（ほかの人の ie.〇〇 には渡さない）
const homeOrigin = (request) => {
  const m = /^[a-z0-9-]+\.([a-z0-9-]+\.workers\.dev)$/i.exec(new URL(request.url).hostname);
  return m ? `https://ie.${m[1]}` : '';
};
const originOk = (origin, request) => !!origin && (RET_ORIGIN.test(origin) || origin.toLowerCase() === homeOrigin(request));
const SCOPE = 'openid email https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';

const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function key(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`${env.GOOGLE_CLIENT_SECRET}:hibi-rt`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), enc.encode(text));
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
  return b64u(out);
}
export async function unseal(env, s) {
  const b = unb64u(String(s || ''));
  if (b.length < 29) throw new Error('bad');
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, await key(env), b.slice(12)));
}

function retOk(ret, request) {
  try { const u = new URL(ret); return originOk(u.origin, request) ? u : null; } catch { return null; }
}
const cbURL = (request) => new URL('/hibi-auth/cb', request.url).toString();
const back = (ret, hash) => { const u = new URL(ret); u.hash = hash; return Response.redirect(u.toString(), 302); };
const cors = (res, origin, request) => {
  res.headers.append('vary', 'Origin');
  if (originOk(origin, request)) { res.headers.set('access-control-allow-origin', origin); res.headers.set('access-control-allow-headers', 'content-type'); res.headers.set('access-control-allow-methods', 'POST, OPTIONS'); }
  res.headers.set('cache-control', 'no-store');
  return res;
};
const jsonRes = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function handleHibiAuth(request, env) {
  const url = new URL(request.url), origin = request.headers.get('origin');
  const path = url.pathname.slice('/hibi-auth'.length);
  const ready = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), origin, request);

  // 1. ひび手帳から来る → Google のログイン画面へ
  if (path === '/start') {
    const ret = retOk(url.searchParams.get('ret'), request);
    if (!ret) return new Response('ひび手帳からのみ使えます', { status: 400 });
    if (!ready) return back(ret.toString(), 'gauth_err=setup');
    const state = b64u(enc.encode(JSON.stringify({ ret: ret.toString(), s: String(url.searchParams.get('s') || '').slice(0, 64) })));
    const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: cbURL(request), response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
    const hint = url.searchParams.get('hint'); if (hint) q.set('login_hint', hint.slice(0, 200));
    return Response.redirect(`${GOOGLE_AUTH}?${q}`, 302);
  }

  // 2. Google から戻る → 鍵を受け取り、暗号にしてひび手帳へ返す
  if (path === '/cb') {
    let st; try { st = JSON.parse(dec.decode(unb64u(url.searchParams.get('state') || ''))); } catch { st = null; }
    const ret = st && retOk(st.ret, request);
    if (!ret) return new Response('ひび手帳からのみ使えます', { status: 400 });
    const tag = `&s=${encodeURIComponent(st.s || '')}`;
    if (url.searchParams.get('error')) return back(ret.toString(), `gauth_err=${encodeURIComponent(url.searchParams.get('error'))}${tag}`);
    if (!ready) return back(ret.toString(), `gauth_err=setup${tag}`);
    const r = await fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: url.searchParams.get('code') || '', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: cbURL(request), grant_type: 'authorization_code' }) });
    const t = await r.json().catch(() => ({}));
    if (!r.ok || !t.refresh_token) return back(ret.toString(), `gauth_err=${encodeURIComponent(t.error || 'token')}${tag}`);
    let email = '';
    try { email = JSON.parse(dec.decode(unb64u(String(t.id_token).split('.')[1]))).email || ''; } catch {}
    const payload = { rt: await seal(env, t.refresh_token), at: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000, email };
    return back(ret.toString(), `gauth=${encodeURIComponent(b64u(enc.encode(JSON.stringify(payload))))}${tag}`);
  }

  // 3. ひび手帳がドライブに書く前に、短い鍵（1時間）をもらう
  if (path === '/token' && request.method === 'POST') {
    if (!originOk(origin, request)) return jsonRes({ error: 'origin' }, 403);
    if (!ready) return cors(jsonRes({ error: 'setup' }, 503), origin, request);
    const body = await request.json().catch(() => ({}));
    let rt; try { rt = await unseal(env, body.rt); } catch { return cors(jsonRes({ error: 'revoked' }, 401), origin, request); }
    const r = await fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: rt, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }) });
    const t = await r.json().catch(() => ({}));
    if (!r.ok || !t.access_token) return cors(jsonRes({ error: t.error === 'invalid_grant' ? 'revoked' : 'google' }, t.error === 'invalid_grant' ? 401 : 502), origin, request);
    return cors(jsonRes({ at: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 }), origin, request);
  }

  // 4. ログアウト：Google 側の許可も取り消す
  if (path === '/revoke' && request.method === 'POST') {
    if (!originOk(origin, request)) return jsonRes({ error: 'origin' }, 403);
    const body = await request.json().catch(() => ({}));
    try { const rt = await unseal(env, body.rt); await fetch(`${GOOGLE_REVOKE}?token=${encodeURIComponent(rt)}`, { method: 'POST' }); } catch {}
    return cors(jsonRes({ ok: true }), origin, request);
  }
  return new Response('Not found', { status: 404 });
}
