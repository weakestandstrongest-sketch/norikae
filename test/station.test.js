import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stationKey, stationPlaces, findStation } from '../src/nearest.js';
import worker from '../src/index.js';

test('駅名は括弧と「駅」を外して探す', () => {
  assert.equal(stationKey('岐阜(JR)'), '岐阜');
  assert.equal(stationKey('名鉄岐阜駅'), '名鉄岐阜');
  assert.equal(stationKey('金山（愛知）'), '金山');
});

const hr = { response: { station: [
  { name: '岐阜', line: 'JR東海道本線', x: '136.756425', y: '35.409431', prefecture: '岐阜県' },
  { name: '岐阜', line: 'JR高山本線', x: '136.756425', y: '35.409431', prefecture: '岐阜県' },
  { name: '岐阜', line: 'どこか別の線', x: '140.1', y: '38.2', prefecture: '山形県' },
] } };

test('同じ駅の別の路線は1つにまとめ、別の場所の同じ名前の駅は残す', () => {
  const p = stationPlaces(hr);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0].lines, ['JR東海道本線', 'JR高山本線']);
  assert.equal(p[0].lat, 35.409431);
});

test('Worker：/api/station はひび手帳（github.io）から使える', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (u) => { assert.ok(String(u).includes('getStations') && String(u).includes(encodeURIComponent('岐阜'))); return Response.json(hr); };
  try {
    const res = await worker.fetch(new Request('https://norikae.example.workers.dev/api/station?name=' + encodeURIComponent('岐阜(JR)'), { headers: { origin: 'https://weakestandstrongest-sketch.github.io' } }), {}, { waitUntil() {} });
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://weakestandstrongest-sketch.github.io');
    const j = await res.json();
    assert.equal(j.stations.length, 2);
  } finally { globalThis.fetch = orig; }
});
