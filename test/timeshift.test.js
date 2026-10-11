import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// public/timeshift.js はブラウザ用のスクリプトなので vm で読み込む
const ctx = {};
vm.runInNewContext(readFileSync(new URL('../public/timeshift.js', import.meta.url), 'utf8') + '\nthis.TimeShift = TimeShift;', ctx);
const { plan, nextTrainFrom } = ctx.TimeShift;

const at = (s) => new Date(s);
const hm = (d) => `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const R = (dep, arr) => ({ dep, arr });
// vm 内で作られた配列は deepEqual で比べられないので、こちら側の配列に直す
const ds = (p) => Array.from(p.dates, hm);

test('出発検索の次：出発のまま、最も早い出発の 1 分後', () => {
  const p = plan(1, 'dep', at('2026-10-12T10:00'), [R('10:10', '10:40'), R('10:05', '10:50')]);
  assert.equal(p.type, 'dep');
  assert.deepEqual(ds(p), ['10/12 10:06']);
});

test('出発検索の前：到着に変わらず、少しずつさかのぼる（6時まで飛ばない）', () => {
  const p = plan(-1, 'dep', at('2026-10-12T10:00'), [R('10:03', '11:00'), R('10:08', '10:58')]);
  assert.equal(p.type, 'dep');
  assert.deepEqual(ds(p), ['10/12 09:53', '10/12 09:43', '10/12 09:23', '10/12 08:33']);
  // 今と同じ電車しか出てこない結果は採用しない
  assert.equal(p.accept([R('10:03', '11:00'), R('10:08', '10:58')]), false);
  // 直前の電車が出てきたら採用
  assert.equal(p.accept([R('09:57', '10:52'), R('10:03', '11:00')]), true);
});

test('到着検索の次：到着のまま、今より遅く着く電車が出るまで広げる', () => {
  const routes = [R('12:30', '12:58'), R('09:45', '12:50'), R('12:20', '12:55')];
  const p = plan(1, 'arr', at('2026-10-12T13:00'), routes);
  assert.equal(p.type, 'arr');
  assert.deepEqual(ds(p), ['10/12 13:08', '10/12 13:18', '10/12 13:38', '10/12 14:28']);
  assert.equal(p.accept(routes), false);
  assert.equal(p.accept([R('12:40', '13:05')]), true);
});

test('到着検索の前：到着のまま、最も遅い到着の 1 分前', () => {
  const p = plan(-1, 'arr', at('2026-10-12T13:00'), [R('12:30', '12:58'), R('12:20', '12:50')]);
  assert.equal(p.type, 'arr');
  assert.deepEqual(ds(p), ['10/12 12:57']);
});

test('出発検索の次：検索時刻より前には戻らない', () => {
  const p = plan(1, 'dep', at('2026-10-12T13:00'), [R('10:00', '14:00')]);
  assert.deepEqual(ds(p), ['10/12 13:01']);
});

test('日付をまたぐ：23:50 出発の次が翌日 0 時台、0:10 出発の前が前日', () => {
  assert.deepEqual(ds(plan(1, 'dep', at('2026-10-12T23:50'), [R('00:05', '00:30')])), ['10/13 00:06']);
  const p = plan(-1, 'dep', at('2026-10-13T00:05'), [R('00:10', '00:40')]);
  assert.equal(hm(p.dates[0]), '10/13 00:00');
  assert.equal(hm(p.dates[1]), '10/12 23:50');
  assert.equal(p.accept([R('23:55', '00:20')]), true);
});

test('終電・始発：朝や夜に検索しても日付がずれない', () => {
  assert.deepEqual(ds(plan(1, 'last', at('2026-10-12T08:00'), [R('23:40', '00:20')])), ['10/12 23:41']);
  assert.deepEqual(ds(plan(1, 'last', at('2026-10-12T08:00'), [R('00:10', '00:50')])), ['10/13 00:11']);
  assert.deepEqual(ds(plan(1, 'first', at('2026-10-12T21:00'), [R('05:02', '05:40')])), ['10/12 05:03']);
});

test('結果がないときは 30 分ずらし、種類は変えない', () => {
  assert.deepEqual(ds(plan(1, 'dep', at('2026-10-12T13:00'), [])), ['10/12 13:30']);
  assert.deepEqual(ds(plan(-1, 'dep', at('2026-10-12T13:00'), [])), ['10/12 12:30']);
  const p = plan(-1, 'arr', at('2026-10-12T13:00'), []);
  assert.equal(p.type, 'arr');
  assert.deepEqual(ds(p), ['10/12 12:30']);
});

test('途中駅から 1 本後：発車時刻の 1 分後', () => {
  assert.equal(hm(nextTrainFrom('13:10', 'dep', at('2026-10-12T13:00'))), '10/12 13:11');
  assert.equal(hm(nextTrainFrom('00:15', 'dep', at('2026-10-12T23:40'))), '10/13 00:16');
  assert.equal(nextTrainFrom('', 'dep', at('2026-10-12T13:00')), null);
});
