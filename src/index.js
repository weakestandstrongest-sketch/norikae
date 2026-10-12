import { buildSearchUrl, parseResult, InputError, YAHOO_ORIGIN } from './yahoo.js';
import { parseCoords, findNearest, findAddress } from './nearest.js';
import { lookupTimetable } from './timetable.js';
import { parseTrainPage } from './train.js';

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

  const { routes, total } = parseResult(await res.text());
  const body = routes.length
    ? { routes, total: total || routes.length, yahooUrl: publicUrl }
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

// 駅の時刻表（前後のダイヤで全部の電車を出すため）
async function handleTimetable(request, env, ctx) {
  const p = new URL(request.url).searchParams;
  const code = p.get('code') || '';
  const date = p.get('date') || '';
  const time = p.get('time') || '';
  if (!/^\d{3,8}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return json({ error: 'パラメータが正しくありません' }, 400);
  }
  const line = (p.get('line') || '').slice(0, 60);
  const destination = (p.get('dest') || '').slice(0, 40);

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.norikae/timetable?${new URLSearchParams({ code, date, time, line, destination })}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const fetchPage = async (path) => {
    const res = await fetch((env.UPSTREAM || YAHOO_ORIGIN) + path, {
      headers: { 'user-agent': UA, 'accept-language': 'ja' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  };
  let result;
  try {
    result = await lookupTimetable({ code, date, time, line, destination }, fetchPage);
  } catch (e) {
    return json({ error: '時刻表を取得できませんでした' }, 502);
  }
  if (!result) return json({ error: 'この駅の時刻表は見つかりませんでした' }, 404);
  const out = json(result, 200, { 'cache-control': 'public, max-age=3600' });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

// 列車ごとの停車駅と時刻（前後のダイヤで、その電車を使う経路を作るため）
async function handleTrain(request, env, ctx) {
  const p = new URL(request.url).searchParams;
  const ids = ['code', 'group', 'train', 'kind', 'hh', 'mm'].map((k) => p.get(k) || '');
  if (!ids.every((v) => /^\d{1,9}$/.test(v))) return json({ error: 'パラメータが正しくありません' }, 400);
  const [code, group, train, kind, hh, mm] = ids;
  const path = `/timetable/${code}/${group}/${train}?kind=${kind}&hh=${Number(hh)}&mm=${Number(mm)}`;

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.norikae/train${path}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let html;
  try {
    const res = await fetch((env.UPSTREAM || YAHOO_ORIGIN) + path, {
      headers: { 'user-agent': UA, 'accept-language': 'ja' },
    });
    if (!res.ok) return json({ error: `列車の情報を取得できませんでした（${res.status}）` }, 502);
    html = await res.text();
  } catch (e) {
    return json({ error: '列車の情報を取得できませんでした' }, 502);
  }
  const { stops, outline } = parseTrainPage(html);
  if (!stops.length) return json({ error: 'この電車の停車駅を読み取れませんでした', path, outline }, 422);
  const out = json({ stops }, 200, { 'cache-control': 'public, max-age=3600' });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/search') return handleSearch(request, env, ctx);
    if (url.pathname === '/api/nearest') return handleNearest(request);
    if (url.pathname === '/api/timetable') return handleTimetable(request, env, ctx);
    if (url.pathname === '/api/train') return handleTrain(request, env, ctx);
    if (url.pathname === '/api/health') return json({ ok: true });
    // それ以外は public/ の静的ファイル
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};
