import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSearchUrl, parseResult, InputError } from '../src/yahoo.js';

const html = readFileSync(new URL('./fixtures/result.html', import.meta.url), 'utf8');

test('経路の概要を読み取る', () => {
  const { routes } = parseResult(html);
  assert.equal(routes.length, 2);
  const s = routes[0].summary;
  assert.equal(s.dep, '13:05');
  assert.equal(s.arr, '13:12');
  assert.equal(s.duration, '7分(乗車5分)');
  assert.equal(s.transfers, 0);
  assert.equal(s.fare, 1170);
  assert.equal(s.fareNote, '(IC優先)');
  assert.deepEqual(s.tags, ['早', '安', '楽']);
  assert.equal(s.alert, false);
  assert.equal(routes[1].summary.alert, true);
});

test('入れ子の fareSection を順番通りに展開する', () => {
  const steps = parseResult(html).routes[0].steps;
  assert.deepEqual(steps.map((s) => s.kind), ['station', 'access', 'station', 'access', 'station']);
  assert.deepEqual(steps[0], { kind: 'station', name: '新宿', arr: '', dep: '13:05' });
  assert.equal(steps[1].line, 'JR山手線内回り');
  assert.equal(steps[1].destination, '渋谷行');
  assert.equal(steps[1].color, '#7ac142');
  assert.equal(steps[1].platform, '[発] 14番線 → [着] 1番線');
  assert.equal(steps[2].arr, '13:09');
  assert.equal(steps[2].dep, '13:10');
  assert.equal(steps[3].walk, true);
  assert.equal(steps[3].alert, true);
  assert.equal(steps[3].color, '#ff0000');
  assert.equal(steps[4].arr, '13:12');
});

test('リンクのない駅名も読める', () => {
  const steps = parseResult(html).routes[1].steps;
  assert.equal(steps[0].name, '東京タワー');
});

test('経路がないページは空配列', () => {
  assert.deepEqual(parseResult('<html><body>該当なし</body></html>').routes, []);
});

test('検索 URL を作る', () => {
  const p = new URLSearchParams('from=新宿&to=渋谷&via=代々木&date=2026-10-12&time=9:05&type=arr&s=1&shin=0');
  const u = new URL(buildSearchUrl(p));
  assert.equal(u.origin + u.pathname, 'https://transit.yahoo.co.jp/search/result');
  const q = u.searchParams;
  assert.equal(q.get('from'), '新宿');
  assert.equal(q.get('via'), '代々木');
  assert.equal(q.get('hh'), '09');
  assert.equal(q.get('m1'), '0');
  assert.equal(q.get('m2'), '5');
  assert.equal(q.get('type'), '4');
  assert.equal(q.get('s'), '1');
  assert.equal(q.get('shin'), '0');
  assert.equal(q.get('ex'), '1');
});

test('不正な入力は InputError', () => {
  assert.throws(() => buildSearchUrl(new URLSearchParams('from=a')), InputError);
  assert.throws(() => buildSearchUrl(new URLSearchParams('from=a&to=b&date=x&time=1:00')), InputError);
});
