'use strict';

// 「前の時間」「次の時間」で使う日時の計算
// （画面に依存しない純粋な関数だけを置き、テストできるようにしている）
const TimeShift = (() => {
  const MIN = 60e3;
  const HALF_DAY = 12 * 3600e3;

  // 結果の時刻（"HH:MM"）を日付に直すときの基準。
  // 始発・終電は入力時刻と関係なく早朝・深夜の結果が返るので、基準をずらす
  function anchorFor(type, base) {
    const d = new Date(base);
    if (type === 'first') d.setHours(6, 0, 0, 0);
    if (type === 'last') d.setHours(23, 0, 0, 0);
    return d;
  }

  // "HH:MM" を基準日時から ±12 時間以内の日時にする（日付またぎの補正）
  function nearDate(hhmm, anchor) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return null;
    const d = new Date(anchor);
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (d - anchor > HALF_DAY) d.setDate(d.getDate() - 1);
    if (anchor - d > HALF_DAY) d.setDate(d.getDate() + 1);
    return d;
  }

  /**
   * 次（direction=1）／前（direction=-1）の検索条件を返す。
   * type: 今の検索の種類、base: 今の検索の日時、routes: 結果の summary 配列
   * 戻り値: { type, date }
   */
  function shift(direction, type, base, routes) {
    const anchor = anchorFor(type, base);
    const deps = routes.map((r) => nearDate(r.dep, anchor)).filter(Boolean).map(Number);
    const arrs = routes.map((r) => nearDate(r.arr, anchor)).filter(Boolean).map(Number);

    if (direction > 0) {
      // 次の時間：出発時刻で検索
      let t;
      if (!deps.length) {
        t = Number(base) + 30 * MIN;
      } else if (type === 'arr') {
        // 到着検索の結果は遠回りのルートが数時間前に出発していることがあるので、
        // 最も遅く出発するルートを基準にする
        t = Math.max(...deps) + MIN;
      } else {
        t = Math.min(...deps) + MIN;
        if (type === 'dep') t = Math.max(t, Number(base) + MIN); // 今の検索より前には戻らない
      }
      return { type: 'dep', date: new Date(t) };
    }

    // 前の時間：到着時刻で検索
    let t;
    if (!arrs.length) {
      t = Number(base) - 30 * MIN;
      return { type: type === 'arr' ? 'arr' : 'dep', date: new Date(t) };
    }
    if (type === 'arr') {
      t = Math.max(...arrs) - MIN;
      t = Math.min(t, Number(base) - MIN); // 今の検索より後には進まない
    } else {
      // 出発検索の結果は遅く着くルートも混ざるので、最も早く着くルートを基準にする
      t = Math.min(...arrs) - MIN;
    }
    return { type: 'arr', date: new Date(t) };
  }

  return { shift, nearDate, anchorFor };
})();
