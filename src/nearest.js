// 緯度経度から最寄り駅を探す（HeartRails Express API）
// iPhone から直接呼ぶと失敗することがあるので Worker 経由にしている
const ENDPOINTS = ['https://express.heartrails.com/api/json', 'http://express.heartrails.com/api/json'];

export function parseCoords(params) {
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  // 日本周辺のみ受け付ける
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 20 || lat > 46 || lng < 122 || lng > 154) return null;
  return { lat: lat.toFixed(6), lng: lng.toFixed(6) };
}

// 同じ駅の複数路線をまとめ、近い順に最大 5 駅
export function summarizeStations(json) {
  const list = (json && json.response && json.response.station) || [];
  const byName = new Map();
  for (const st of list) {
    if (!st || !st.name) continue;
    const item = byName.get(st.name);
    if (item) {
      if (st.line && !item.lines.includes(st.line)) item.lines.push(st.line);
    } else {
      byName.set(st.name, { name: st.name, lines: st.line ? [st.line] : [], distance: st.distance || '' });
    }
  }
  return [...byName.values()].slice(0, 5);
}

export async function findNearest(coords, fetchImpl = fetch) {
  const qs = `?method=getStations&x=${coords.lng}&y=${coords.lat}`;
  let lastError;
  for (const base of ENDPOINTS) {
    try {
      const res = await fetchImpl(base + qs, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return summarizeStations(await res.json());
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// ---------- 駅名 → 緯度経度（ひび手帳の MOVE：予定に入れた電車の区間を、駅を結んだ線で描くため） ----------
// 「岐阜(JR)」「名鉄岐阜駅」のような書き方は、括弧と「駅」を外して探す
export const stationKey = (name) => String(name || '').normalize('NFKC').replace(/[(（][^)）]*[)）]/g, '').replace(/駅$/, '').trim().slice(0, 40);

// 同じ名前の駅（路線ごと・別の県）の場所をまとめる。近い場所は1つにする（同じ駅の別の路線）
export function stationPlaces(json) {
  const list = (json && json.response && json.response.station) || [], out = [];
  for (const st of list) {
    const lat = Number(st && st.y), lng = Number(st && st.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const same = out.find((p) => Math.abs(p.lat - lat) < 0.01 && Math.abs(p.lng - lng) < 0.01);
    if (same) { if (st.line && !same.lines.includes(st.line)) same.lines.push(st.line); continue; }
    out.push({ name: st.name, lat, lng, prefecture: st.prefecture || '', lines: st.line ? [st.line] : [] });
  }
  return out.slice(0, 10);
}

export async function findStation(name, fetchImpl = fetch) {
  const key = stationKey(name);
  if (!key) return [];
  let lastError;
  for (const base of ENDPOINTS) {
    try {
      const res = await fetchImpl(`${base}?method=getStations&name=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' }, cf: { cacheTtl: 86400 * 7, cacheEverything: true } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return stationPlaces(await res.json());
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// ---------- 緯度経度 → 住所 ----------
// 国土地理院の逆ジオコーダー（市区町村コード＋町名）を使い、
// 市区町村名は地理院地図の muni.js の対応表で引く。失敗したら HeartRails Geo API を使う。
const GSI_REVERSE = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';
const GSI_MUNI = 'https://maps.gsi.go.jp/js/muni.js';
const HEARTRAILS_GEO = ['https://geoapi.heartrails.com/api/json', 'http://geoapi.heartrails.com/api/json'];

const noSpace = (s) => (s || '').replace(/[\s　]/g, '');

// muni.js の 'GSI.MUNI_ARRAY["13104"] = '13,東京都,13104,新宿区';' から { '13104': '東京都新宿区' } を作る
export function parseMuni(js) {
  const map = {};
  const re = /MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(js))) {
    const parts = m[2].split(',');
    if (parts.length >= 4) map[String(Number(m[1]))] = noSpace(parts[1]) + noSpace(parts[3]);
  }
  return map;
}

let muniMap = null; // Worker が動いている間は使い回す
async function loadMuni(fetchImpl) {
  if (muniMap) return muniMap;
  const res = await fetchImpl(GSI_MUNI, { cf: { cacheTtl: 86400 * 7, cacheEverything: true } });
  if (!res.ok) throw new Error(`muni HTTP ${res.status}`);
  muniMap = parseMuni(await res.text());
  return muniMap;
}

async function addressFromGsi(coords, fetchImpl) {
  const [res, muni] = await Promise.all([
    fetchImpl(`${GSI_REVERSE}?lat=${coords.lat}&lon=${coords.lng}`),
    loadMuni(fetchImpl),
  ]);
  if (!res.ok) throw new Error(`gsi HTTP ${res.status}`);
  const r = ((await res.json()) || {}).results;
  if (!r || !r.muniCd) throw new Error('gsi: no result');
  const city = muni[String(Number(r.muniCd))];
  if (!city) throw new Error('gsi: unknown muniCd');
  const town = noSpace(r.lv01Nm);
  return city + (town && town !== '－' && town !== '-' ? town : '');
}

async function addressFromHeartRails(coords, fetchImpl) {
  let lastError;
  for (const base of HEARTRAILS_GEO) {
    try {
      const res = await fetchImpl(`${base}?method=searchByGeoLocation&x=${coords.lng}&y=${coords.lat}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const loc = (((await res.json()) || {}).response || {}).location;
      if (!loc || !loc.length) throw new Error('heartrails geo: no result');
      return noSpace(loc[0].prefecture) + noSpace(loc[0].city) + noSpace(loc[0].town);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export async function findAddress(coords, fetchImpl = fetch) {
  try {
    return await addressFromGsi(coords, fetchImpl);
  } catch (e) {
    return addressFromHeartRails(coords, fetchImpl);
  }
}

// テスト用
export function resetMuniCache() { muniMap = null; }
