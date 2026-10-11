import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// public/timeshift.js はブラウザ用のスクリプトなので vm で読み込む
const ctx = {};
vm.runInNewContext(readFileSync(new URL('../public/timeshift.js', import.meta.url), 'utf8') + '\nthis.TimeShift = TimeShift;', ctx);
const { shift } = ctx.TimeShift;

const at = (s) => new Date(s);
const hm = (d) => `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

test('出発検索の次：最も早い出発の 1 分後', () => {
  const r = shift(1, 'dep', at('2026-10-12T13:00'), [{ dep: '13:10', arr: '13:40' }, { dep: '13:05', arr: '13:50' }]);
  assert.equal(r.type, 'dep');
  assert.equal(hm(r.date), '10/12 13:06');
});

test('到着検索の次：遠回りのルートがあっても数時間戻らない', () => {
  const routes = [{ dep: '12:30', arr: '12:58' }, { dep: '09:45', arr: '12:50' }, { dep: '12:20', arr: '12:55' }];
  const r = shift(1, 'arr', at('2026-10-12T13:00'), routes);
  assert.equal(r.type, 'dep');
  assert.equal(hm(r.date), '10/12 12:31');
});

test('出発検索の次：検索時刻より前には戻らない', () => {
  const r = shift(1, 'dep', at('2026-10-12T13:00'), [{ dep: '10:00', arr: '14:00' }]);
  assert.equal(hm(r.date), '10/12 13:01');
});

test('出発検索の前：最も早い到着の 1 分前で到着検索', () => {
  const routes = [{ dep: '13:05', arr: '13:12' }, { dep: '13:07', arr: '13:20' }, { dep: '13:01', arr: '16:00' }];
  const r = shift(-1, 'dep', at('2026-10-12T13:00'), routes);
  assert.equal(r.type, 'arr');
  assert.equal(hm(r.date), '10/12 13:11');
});

test('到着検索の前：最も遅い到着の 1 分前', () => {
  const r = shift(-1, 'arr', at('2026-10-12T13:00'), [{ dep: '12:30', arr: '12:58' }, { dep: '12:20', arr: '12:50' }]);
  assert.equal(hm(r.date), '10/12 12:57');
});

test('日付をまたぐ：23:50 出発の次が翌日 0 時台', () => {
  const r = shift(1, 'dep', at('2026-10-12T23:50'), [{ dep: '00:05', arr: '00:30' }]);
  assert.equal(hm(r.date), '10/13 00:06');
});

test('終電：朝に検索しても前日にならない', () => {
  const r = shift(1, 'last', at('2026-10-12T08:00'), [{ dep: '23:40', arr: '00:20' }]);
  assert.equal(hm(r.date), '10/12 23:41');
  const r2 = shift(1, 'last', at('2026-10-12T08:00'), [{ dep: '00:10', arr: '00:50' }]);
  assert.equal(hm(r2.date), '10/13 00:11');
});

test('始発', () => {
  const r = shift(1, 'first', at('2026-10-12T21:00'), [{ dep: '05:02', arr: '05:40' }]);
  assert.equal(hm(r.date), '10/12 05:03');
});

test('結果がないときは 30 分ずらす', () => {
  assert.equal(hm(shift(1, 'dep', at('2026-10-12T13:00'), []).date), '10/12 13:30');
  assert.equal(hm(shift(-1, 'dep', at('2026-10-12T13:00'), []).date), '10/12 12:30');
});
