import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoords, summarizeStations, findNearest } from '../src/nearest.js';

test('日本の範囲外や不正な座標は受け付けない', () => {
  assert.equal(parseCoords(new URLSearchParams('lat=abc&lng=139')), null);
  assert.equal(parseCoords(new URLSearchParams('lat=51.5&lng=-0.1')), null);
  assert.deepEqual(parseCoords(new URLSearchParams('lat=35.6896&lng=139.7006')), { lat: '35.689600', lng: '139.700600' });
});

test('同じ駅の路線をまとめる', () => {
  const json = { response: { station: [
    { name: '新宿', line: 'JR山手線', distance: '120m' },
    { name: '新宿', line: '小田急線', distance: '150m' },
    { name: '新宿三丁目', line: '東京メトロ丸ノ内線', distance: '400m' },
  ] } };
  assert.deepEqual(summarizeStations(json), [
    { name: '新宿', lines: ['JR山手線', '小田急線'], distance: '120m' },
    { name: '新宿三丁目', lines: ['東京メトロ丸ノ内線'], distance: '400m' },
  ]);
  assert.deepEqual(summarizeStations({}), []);
});

test('https が失敗したら http で再試行する', async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.startsWith('https:')) throw new Error('tls');
    return new Response(JSON.stringify({ response: { station: [{ name: '渋谷', line: 'JR', distance: '1m' }] } }));
  };
  const r = await findNearest({ lat: '35.658000', lng: '139.701000' }, fake);
  assert.equal(r[0].name, '渋谷');
  assert.equal(calls.length, 2);
  assert.match(calls[1], /^http:\/\/express\.heartrails\.com\/api\/json\?method=getStations&x=139\.701000&y=35\.658000$/);
});
