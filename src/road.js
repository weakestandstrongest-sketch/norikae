// 2地点の間の道（ひび手帳・move の MOVE：記録が少ない日にまっすぐな線にならないよう、道に沿わせる）
// OpenStreetMap のデータで経路を出す、FOSSGIS の公開サーバー（routing.openstreetmap.de）を使う。
// 1日の移動を数本たずねる程度の使い方。同じ2地点の答えは30日キャッシュする
const MODES = { foot: 'routed-foot', bike: 'routed-bike', car: 'routed-car' };
const UA = 'norikae-hibi/1.0 (+https://github.com/weakestandstrongest-sketch/norikae)';

// 「35.40943,136.75642」→ { lat, lng }（日本のあたりだけ）
export function parsePoint(s) {
  const m = /^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(String(s || '').trim());
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  if (lat < 20 || lat > 46 || lng < 122 || lng > 154) return null;
  return { lat: +lat.toFixed(5), lng: +lng.toFixed(5) };
}

// OSRM の答えから、道の点（[緯度, 経度]、多すぎるときは間引く）と長さ（m）
export function roadOf(json) {
  const r = json && Array.isArray(json.routes) && json.routes[0];
  const c = r && r.geometry && Array.isArray(r.geometry.coordinates) ? r.geometry.coordinates : null;
  if (!c || c.length < 2) return null;
  let pts = c.map(([lng, lat]) => [+(+lat).toFixed(5), +(+lng).toFixed(5)]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pts.length > 400) { const k = Math.ceil(pts.length / 400); pts = pts.filter((_, i) => i % k === 0 || i === pts.length - 1); }
  return { coords: pts, distance: Math.round(+r.distance || 0) };
}

export async function findRoad(mode, a, b, fetchImpl = fetch) {
  if (!MODES[mode]) throw new Error('mode');
  const url = `https://routing.openstreetmap.de/${MODES[mode]}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`;
  const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'application/json' }, cf: { cacheTtl: 86400 * 30, cacheEverything: true } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return roadOf(await res.json());
}
