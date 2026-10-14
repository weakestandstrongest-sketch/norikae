import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSuggest, normalizeCandidate, parseAlternatives, suggestPath } from '../src/suggest.js';
import { parseResult } from '../src/yahoo.js';
import { wrap } from './nextdata.js';

test('候補の名前をそろえる（バス停は「名前/会社」で検索する）', () => {
  assert.deepEqual(normalizeCandidate('則武本郷/岐阜バス'), { name: '則武本郷', value: '則武本郷/岐阜バス', kind: 'bus', company: '岐阜バス' });
  assert.deepEqual(normalizeCandidate('則武本郷〔岐阜バス〕'), { name: '則武本郷', value: '則武本郷/岐阜バス', kind: 'bus', company: '岐阜バス' });
  assert.deepEqual(normalizeCandidate('則武本郷', { company: '岐阜バス' }), { name: '則武本郷', value: '則武本郷/岐阜バス', kind: 'bus', company: '岐阜バス' });
  assert.deepEqual(normalizeCandidate('金山(愛知県)'), { name: '金山(愛知県)', value: '金山(愛知県)', kind: 'station', company: '' });
  assert.deepEqual(normalizeCandidate('<span>西岐阜</span>'), { name: '西岐阜', value: '西岐阜', kind: 'station', company: '' });
  assert.equal(normalizeCandidate(''), null);
});

test('時刻表検索ページのリンクと埋め込み JSON から候補を出す', () => {
  const html = wrap({
    title: '則武 の検索結果',
    stationList: [
      { Name: '則武本郷', Code: '29001', Type: 'bus', CompanyName: '岐阜バス', Yomi: 'のりたけほんごう' },
      { Name: '則武(岐阜県)', Code: '29002', Yomi: 'のりたけ' },
      { Name: '名古屋', Code: '1', Yomi: 'なごや' }, // 入力と関係ないもの（JSON 由来）は出さない
    ],
  }).replace('<div>本文</div>', '<ul><li><a href="/timetable/29003">則武新町/岐阜バス</a></li><li><a href="/timetable/29001">則武本郷/岐阜バス</a></li></ul>');
  const items = parseSuggest(html, '則武');
  assert.deepEqual(items.map((i) => i.value), ['則武新町/岐阜バス', '則武本郷/岐阜バス', '則武(岐阜県)']);
  assert.equal(items[1].kind, 'bus');
  assert.equal(items[1].company, '岐阜バス');
  assert.equal(items[1].code, '29001');
  assert.equal(items[2].kind, 'station');
  // 読み（ひらがな）でも引ける
  const byYomi = parseSuggest(html, 'のりたけほ').map((i) => i.value);
  assert.ok(byYomi.includes('則武本郷/岐阜バス'));
  assert.ok(!byYomi.includes('名古屋'));
});

test('ページの形が違っても壊れず空を返す', () => {
  assert.deepEqual(parseSuggest('', '則武'), []);
  assert.deepEqual(parseSuggest('<html><script id="__NEXT_DATA__">{broken</script></html>', '則武'), []);
  assert.equal(suggestPath('則武 本郷'), '/timetable/search?q=%E5%89%87%E6%AD%A6+%E6%9C%AC%E9%83%B7');
});

test('経路検索ページの「ほかの候補」を読み取る', () => {
  const nd = { props: { pageProps: { naviSearchParam: { otherQueryInfo: { fromList: [{ name: '則武本郷/岐阜バス' }, '則武'], toList: [] } } } } };
  assert.deepEqual(parseAlternatives(nd).from.map((c) => c.value), ['則武本郷/岐阜バス', '則武']);
  assert.equal(parseAlternatives({ props: { pageProps: {} } }), null);
  const r = parseResult(wrap({ naviSearchParam: { featureInfoList: [], otherQueryInfo: { toList: [{ name: '則武本郷/岐阜バス' }] } } }));
  assert.equal(r.alt.to[0].value, '則武本郷/岐阜バス');
});
