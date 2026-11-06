import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePoint, roadOf } from '../src/road.js';
import worker from '../src/index.js';

test('地点は日本のあたりの「緯度,経度」だけ', () => {
  assert.deepEqual(parsePoint('35.409431,136.756425'), { lat: 35.40943, lng: 136.75643 });
  assert.equal(parsePoint('0,0'), null);
  assert.equal(parsePoint('abc'), null);
});

const osrm = { routes: [{ distance: 1234.5, geometry: { coordinates: [[136.7564, 35.4094], [136.7580, 35.4100], [136.7600, 35.4120]] } }] };
test('OSRM の答えから、道の点（緯度・経度の順）と長さ', () => {
  const r = roadOf(osrm);
  assert.deepEqual(r.coords[0], [35.4094, 136.7564]);
  assert.equal(r.coords.length, 3);
  assert.equal(r.distance, 1235);
  assert.equal(roadOf({ routes: [] }), null);
});

test('Worker：/api/road はひび手帳・move（github.io）から使え、歩きの経路をたずねる', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (u) => { assert.ok(String(u).includes('routed-foot') && String(u).includes('136.7564,35.4094;136.76,35.412')); return Response.json(osrm); };
  try {
    const res = await worker.fetch(new Request('https://norikae.example.workers.dev/api/road?mode=foot&from=35.4094,136.7564&to=35.412,136.76', { headers: { origin: 'https://weakestandstrongest-sketch.github.io' } }), {}, { waitUntil() {} });
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://weakestandstrongest-sketch.github.io');
    const j = await res.json(); assert.equal(j.coords.length, 3);
    const bad = await worker.fetch(new Request('https://norikae.example.workers.dev/api/road?mode=plane&from=1,2&to=3,4'), {}, { waitUntil() {} });
    assert.equal(bad.status, 400);
  } finally { globalThis.fetch = orig; }
});
