'use strict';

// 「前の時間」「次の時間」で使う日時の計算
// （画面に依存しない純粋な関数だけを置き、テストできるようにしている）
const TimeShift = (() => {
  const MIN = 60e3;
  const HALF_DAY = 12 * 3600e3;
  // 直前・直後の電車が見つかるまで、この分数ずつ広げて探す
  const STEPS = [10, 20, 40, 90];

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

  const times = (routes, key, anchor) =>
    routes.map((r) => nearDate(r[key], anchor)).filter(Boolean).map(Number);

  /**
   * 次（direction=1）／前（direction=-1）の検索計画を返す。
   * type: 今の検索の種類、base: 今の検索の日時、routes: 結果の summary 配列
   *
   * 戻り値: { type, dates, accept }
   *   dates を順に検索し、accept(結果の summary 配列) が true になった結果を表示する。
   *   出発検索なら出発のまま、到着検索なら到着のまま（種類を勝手に変えない）。
   */
  function plan(direction, type, base, routes) {
    const anchor = anchorFor(type, base);
    const deps = times(routes, 'dep', anchor);
    const arrs = times(routes, 'arr', anchor);
    const always = () => true;
    const at = (t) => new Date(t);

    if (type === 'arr') {
      if (!arrs.length) return { type, dates: [at(+base + direction * 30 * MIN)], accept: always };
      const latest = Math.max(...arrs);
      if (direction < 0) {
        // 前：今見えている最も遅い到着より 1 分前までに着く電車
        return { type, dates: [at(Math.min(latest, +base) - MIN)], accept: always };
      }
      // 次：今より後に着く電車が出てくるまで少しずつ広げる
      return {
        type,
        dates: STEPS.map((m) => at(latest + m * MIN)),
        accept: (rs) => times(rs, 'arr', at(latest)).some((t) => t > latest),
      };
    }

    // 出発・始発・終電は「出発」で前後を探す
    if (!deps.length) return { type: 'dep', dates: [at(+base + direction * 30 * MIN)], accept: always };
    const earliest = Math.min(...deps);
    if (direction > 0) {
      // 次：今見えている最も早い出発の 1 分後
      let t = earliest + MIN;
      if (type === 'dep') t = Math.max(t, +base + MIN);
      return { type: 'dep', dates: [at(t)], accept: always };
    }
    // 前：今より前に出る電車が出てくるまで少しずつさかのぼる
    return {
      type: 'dep',
      dates: STEPS.map((m) => at(earliest - m * MIN)),
      accept: (rs) => times(rs, 'dep', at(earliest)).some((t) => t < earliest),
    };
  }

  // 経路の途中駅から「1本後の電車」で検索するときの出発日時
  function nextTrainFrom(hhmm, type, base) {
    const d = nearDate(hhmm, anchorFor(type, base));
    return d ? new Date(+d + MIN) : null;
  }

  return { plan, nextTrainFrom, nearDate, anchorFor };
})();
