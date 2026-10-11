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
