import { buildSearchUrl, parseResult, InputError, YAHOO_ORIGIN } from './yahoo.js';
import { parseCoords, findNearest, findAddress } from './nearest.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

async function handleSearch(request, env, ctx) {
  const params = new URL(request.url).searchParams;
  let yahooUrl;
  try {
    // UPSTREAM はテスト用。本番では Yahoo!乗換案内に固定
    yahooUrl = buildSearchUrl(params, env.UPSTREAM || YAHOO_ORIGIN);
  } catch (e) {
    if (e instanceof InputError) return json({ error: e.message }, 400);
    throw e;
  }
  const publicUrl = buildSearchUrl(params, YAHOO_ORIGIN);

  // 同じ条件の検索は 1 分間キャッシュして Yahoo への負荷を減らす
  const cache = caches.default;
  const cacheKey = new Request(yahooUrl);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let res;
  try {
    res = await fetch(yahooUrl, {
      headers: { 'user-agent': UA, 'accept-language': 'ja' },
    });
  } catch (e) {
    return json({ error: 'Yahoo!乗換案内に接続できませんでした', yahooUrl: publicUrl }, 502);
  }
  if (!res.ok) {
    return json({ error: `Yahoo!乗換案内がエラーを返しました（${res.status}）`, yahooUrl: publicUrl }, 502);
  }

  const { routes } = parseResult(await res.text());
  const body = routes.length
    ? { routes, yahooUrl: publicUrl }
    : { routes, yahooUrl: publicUrl, error: '経路が見つかりませんでした。駅名を確認するか、Yahoo で直接開いてください' };
  const out = json(body, 200, { 'cache-control': 'public, max-age=60' });
  if (routes.length) ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

// 現在地の住所と最寄り駅
async function handleNearest(request) {
  const coords = parseCoords(new URL(request.url).searchParams);
  if (!coords) return json({ error: '位置情報の値が正しくありません' }, 400);
  const [stations, address] = await Promise.allSettled([findNearest(coords), findAddress(coords)]);
  const body = {
    address: address.status === 'fulfilled' ? address.value : '',
    stations: stations.status === 'fulfilled' ? stations.value : [],
  };
  if (!body.address && !body.stations.length) {
    return json({ ...body, error: '現在地の住所・最寄り駅を取得できませんでした' }, 502);
  }
  return json(body);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/search') return handleSearch(request, env, ctx);
    if (url.pathname === '/api/nearest') return handleNearest(request);
    if (url.pathname === '/api/health') return json({ ok: true });
    // それ以外は public/ の静的ファイル
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};
