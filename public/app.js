'use strict';

// ---------- 保存まわり ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('norikae:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('norikae:' + key, JSON.stringify(value)); } catch (e) { /* 保存できなくても動作は続ける */ }
  },
};

const DEFAULT_SETTINGS = {
  engine: 'app',
  sort: '0',
  ticket: 'ic',
  expkind: '1',
  ws: '3',
  shin: true, ex: true, al: true, hb: true, lb: true, sr: true,
};
let settings = Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
if (settings.engine === 'yahooPrint') settings.engine = 'app'; // 旧設定からの移行
let favorites = store.get('favorites', []);
let recent = store.get('history', []);

const ENGINES = {
  app: { label: '検索', hint: 'Yahoo!乗換案内の結果を広告なしで表示します' },
  apple: { label: 'Apple マップで検索', hint: 'Apple マップで開きます（日時は地図アプリ側で変更）' },
  google: { label: 'Google マップで検索', hint: 'Google マップで開きます' },
  yahoo: { label: 'Yahoo サイトで検索', hint: 'Yahoo!乗換案内のサイトで開きます（広告あり）' },
};
const ALT_LABELS = { app: 'アプリ内', apple: 'Apple マップ', google: 'Google マップ', yahoo: 'Yahoo サイト' };

const CURRENT_LOCATION = '現在地';

// ---------- 要素 ----------
const $ = (id) => document.getElementById(id);
const fromEl = $('from');
const toEl = $('to');
const viaEl = $('via');
const whenEl = $('when');
let fromCoords = null; // 「現在地」選択時の座標

// ---------- 日時 ----------
const pad = (n) => String(n).padStart(2, '0');
function toLocalInputValue(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
let timeIsCustom = false; // 時刻を自分で指定したら true（勝手に「今」に戻さない）
function setNow() {
  whenEl.value = toLocalInputValue(new Date());
  timeIsCustom = false;
}
function readWhen() {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(whenEl.value);
  if (!m) { setNow(); return readWhen(); }
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}
const whenToDate = (w) => new Date(w.y, w.mo - 1, w.d, w.h, w.mi);
const dateToWhen = (d) => ({ y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() });
const whenDate = (w) => `${w.y}-${pad(w.mo)}-${pad(w.d)}`;
const whenTime = (w) => `${pad(w.h)}:${pad(w.mi)}`;
function isNearNow(w) {
  return Math.abs(whenToDate(w).getTime() - Date.now()) < 5 * 60 * 1000;
}
function getType() {
  return document.querySelector('input[name="type"]:checked').value;
}
function setType(v) {
  const el = document.querySelector(`input[name="type"][value="${v}"]`);
  if (el) el.checked = true;
}
const TYPE_LABEL = { dep: '出発', arr: '到着', first: '始発', last: '終電' };

// ---------- URL 生成 ----------
function query(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function originFor(q) {
  if (q.from === CURRENT_LOCATION || q.from === '') {
    return q.coords ? `${q.coords.lat},${q.coords.lng}` : '';
  }
  return q.from;
}

// Yahoo の検索条件（アプリ内検索と Yahoo サイトで共通）
function yahooParams(q) {
  const w = q.when;
  const flag = (b) => (b ? 1 : 0);
  return {
    from: q.from,
    to: q.to,
    via: q.via,
    date: whenDate(w),
    time: whenTime(w),
    type: q.type,
    s: settings.sort,
    ticket: settings.ticket,
    expkind: settings.expkind,
    ws: settings.ws,
    al: flag(settings.al),
    shin: flag(settings.shin),
    ex: flag(settings.ex),
    hb: flag(settings.hb),
    lb: flag(settings.lb),
    sr: flag(settings.sr),
  };
}

function buildUrl(engine, q) {
  const w = q.when;
  if (engine === 'apple') {
    return 'https://maps.apple.com/?' + query({ saddr: originFor(q), daddr: q.to, dirflg: 'r' });
  }

  if (engine === 'google') {
    const origin = originFor(q);
    if (q.type === 'dep' && isNearNow(w)) {
      return 'https://www.google.com/maps/dir/?' + query({ api: 1, origin, destination: q.to, travelmode: 'transit' });
    }
    // 日時指定は Google マップの data パラメータで渡す（6e0=出発 6e1=到着 6e2=終電）
    let mode = 0;
    let h = w.h, mi = w.mi;
    if (q.type === 'arr') mode = 1;
    if (q.type === 'last') mode = 2;
    if (q.type === 'first') { h = 4; mi = 0; }
    const sec = Date.UTC(w.y, w.mo - 1, w.d, h, mi) / 1000;
    return `https://www.google.com/maps/dir/${encodeURIComponent(origin)}/${encodeURIComponent(q.to)}` +
      `/data=!4m6!4m5!2m3!6e${mode}!7e2!8j${sec}!3e3`;
  }

  // Yahoo!乗換案内のサイト
  const p = yahooParams(q);
  const typeCode = { dep: 1, arr: 4, first: 3, last: 2 }[q.type];
  return 'https://transit.yahoo.co.jp/search/result?' + query({
    from: p.from, to: p.to, via: p.via,
    y: w.y, m: pad(w.mo), d: pad(w.d), hh: pad(w.h), m1: Math.floor(w.mi / 10), m2: w.mi % 10,
    type: typeCode, ticket: p.ticket, expkind: p.expkind, userpass: 1, ws: p.ws, s: p.s,
    al: p.al, shin: p.shin, ex: p.ex, hb: p.hb, lb: p.lb, sr: p.sr,
  });
}

// ---------- 検索 ----------
function currentQuery() {
  return {
    from: fromEl.value.trim(),
    to: toEl.value.trim(),
    via: $('viaRow').hidden ? '' : viaEl.value.trim(),
    type: getType(),
    when: readWhen(),
    coords: fromCoords,
  };
}

function search(engine) {
  engine = engine || settings.engine;
  if (!timeIsCustom) setNow(); // 「今」のまま時間がたっていたら最新の時刻で検索
  const q = currentQuery();
  const needsStation = engine === 'app' || engine === 'yahoo';

  if (!q.to) { toast('到着駅を入力してください'); toEl.focus(); return; }
  if (needsStation && (!q.from || q.from === CURRENT_LOCATION)) {
    toast('出発駅を入力してください（📍で最寄り駅を入力できます）');
    fromEl.focus();
    return;
  }
  if (!q.from) q.from = CURRENT_LOCATION;

  addHistory(q);
  if (engine === 'app') {
    showResults(q, true);
  } else {
    location.href = buildUrl(engine, q);
  }
}

// ---------- 結果画面 ----------
let shownQuery = null;
let shownRoutes = [];
let resultLoading = false;
let searchSeq = 0;

function resultUrl(q) {
  return '?' + query({ from: q.from, to: q.to, via: q.via, type: q.type, date: whenDate(q.when), time: whenTime(q.when), go: 1 });
}

function showView(name) {
  const isResult = name === 'result';
  $('formView').hidden = isResult;
  $('resultView').hidden = !isResult;
  $('backBtn').hidden = !isResult;
  $('title').textContent = isResult ? '検索結果' : 'のりかえ';
  window.scrollTo(0, 0);
}

function el(tag, className, textContent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (textContent != null) e.textContent = textContent;
  return e;
}

function renderResultHead(q) {
  $('resultRoute').textContent = `${q.from} → ${q.to}` + (q.via ? `（${q.via} 経由）` : '');
  const w = q.when;
  const wd = '日月火水木金土'[whenToDate(w).getDay()];
  $('resultWhen').textContent = q.type === 'first' || q.type === 'last'
    ? `${w.mo}/${w.d}（${wd}）${TYPE_LABEL[q.type]}`
    : `${w.mo}/${w.d}（${wd}）${whenTime(w)} ${TYPE_LABEL[q.type]}`;
  $('openYahoo').href = buildUrl('yahoo', q);
  $('openApple').href = buildUrl('apple', q);
  $('openGoogle').href = buildUrl('google', q);
}

async function fetchRoutes(q) {
  try {
    const res = await fetch('api/search?' + query(yahooParams(q)));
    return await res.json();
  } catch (e) {
    return { error: '通信できませんでした。電波の良いところで再度お試しください', routes: [] };
  }
}

/**
 * 結果画面を表示する。
 * opts.resolve を渡すと、検索の前に日時を決める処理（1本前・1本後さがし）を挟む。
 */
async function showResults(q, push, opts = {}) {
  shownQuery = q;
  if (push) window.history.pushState({ view: 'result' }, '', resultUrl(q));
  showView('result');
  renderResultHead(q);

  const list = $('resultList');
  list.textContent = '';
  list.append(el('p', 'loading', '検索中…'));
  const seq = ++searchSeq;
  shownRoutes = [];
  resultLoading = true;

  if (opts.resolve) {
    $('resultWhen').textContent = '前後の電車を探しています…';
    const resolved = await opts.resolve();
    if (seq !== searchSeq) return;
    q = resolved;
    shownQuery = q;
    window.history.replaceState(window.history.state, '', resultUrl(q));
    renderResultHead(q);
  }

  const data = await fetchRoutes(q);
  if (seq !== searchSeq) return; // 新しい検索が始まっていたら捨てる
  resultLoading = false;

  list.textContent = '';
  if (!data.routes || !data.routes.length) {
    const box = el('div', 'card error');
    box.append(el('p', '', data.error || '経路が見つかりませんでした'));
    const retry = el('button', 'chip', '再読み込み');
    retry.type = 'button';
    retry.addEventListener('click', () => showResults(q, false));
    box.append(retry);
    list.append(box);
    return;
  }
  shownRoutes = data.routes;
  data.routes.forEach((r, i) => list.append(renderRoute(r, i, i === 0)));
}

function renderRoute(route, index, expanded) {
  const s = route.summary;
  const card = el('article', 'card route');

  const head = el('button', 'route-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(expanded));

  const tags = el('div', 'tags');
  tags.append(el('span', 'route-no', `ルート${index + 1}`));
  s.tags.forEach((t) => tags.append(el('span', `tag tag-${{ 早: 'fast', 安: 'cheap', 楽: 'easy' }[t] || 'other'}`, t)));
  if (route.changedAt != null) tags.append(el('span', 'tag tag-changed', '乗り継ぎを変更'));
  if (s.alert) tags.append(el('span', 'tag tag-alert', '⚠ 運行情報'));
  head.append(tags);

  const times = el('div', 'times');
  times.append(el('span', 'big', `${s.dep} → ${s.arr}`));
  head.append(times);

  const meta = el('div', 'meta');
  const parts = [s.duration];
  if (s.transfers != null) parts.push(`乗換 ${s.transfers}回`);
  if (s.fare != null) parts.push(`${s.fare.toLocaleString('ja-JP')}円`);
  meta.textContent = parts.filter(Boolean).join(' ・ ');
  head.append(meta);

  const detail = renderSteps(route.steps, index);
  detail.append(el('li', 'tl-hint', '発車時刻をタップすると前後のダイヤを一覧で見られます。乗換駅の時刻なら、その駅から先の電車だけを変えられます'));
  detail.hidden = !expanded;
  head.addEventListener('click', () => {
    detail.hidden = !detail.hidden;
    head.setAttribute('aria-expanded', String(!detail.hidden));
  });

  card.append(head, detail);
  return card;
}

function renderSteps(steps, routeIndex) {
  const ol = el('ol', 'timeline');
  steps.forEach((st, i) => {
    if (st.kind === 'station') {
      const li = el('li', 'tl-station');
      const time = el('div', 'tl-time');
      if (st.arr) time.append(el('span', '', `${st.arr}着`));
      if (st.dep) {
        const dep = el('button', 'tl-dep', `${st.dep}発`);
        dep.type = 'button';
        dep.setAttribute('aria-label', `${st.name} ${st.dep}発 の前後のダイヤ`);
        dep.addEventListener('click', () => openDia(routeIndex, i));
        time.append(dep);
      }
      const mark = el('div', 'tl-mark');
      mark.append(el('span', i === 0 ? 'tl-dot first' : i === steps.length - 1 ? 'tl-dot last' : 'tl-dot'));
      li.append(time, mark, el('div', 'tl-name', st.name));
      ol.append(li);
    } else {
      const li = el('li', st.walk ? 'tl-access walk' : 'tl-access');
      const mark = el('div', 'tl-mark');
      const bar = el('span', 'tl-bar');
      if (st.color && !st.walk) bar.style.background = st.color;
      mark.append(bar);
      const body = el('div', 'tl-body');
      const line = el('div', 'tl-line', st.line + (st.destination ? ` ${st.destination}` : ''));
      body.append(line);
      const sub = [st.platform, st.stops].filter(Boolean).join(' ・ ');
      if (sub) body.append(el('div', 'tl-sub', sub));
      if (st.alert) body.append(el('div', 'tl-alert', `⚠ ${st.alertText || '運行情報あり'}`));
      li.append(el('div', 'tl-time'), mark, body);
      ol.append(li);
    }
  });
  return ol;
}

// 1本前・1本後で再検索（ホームの入力欄はそのまま、出発／到着の種類も変えない）
function shiftSearch(direction) {
  const q = shownQuery;
  if (!q || resultLoading) return;
  const p = TimeShift.plan(direction, q.type, whenToDate(q.when), shownRoutes.map((r) => r.summary));
  if (!p.probe) {
    showResults({ ...q, type: p.type, when: dateToWhen(p.date) }, true);
    return;
  }
  showResults({ ...q, type: p.type, when: dateToWhen(p.fallback) }, true, {
    resolve: async () => {
      const data = await fetchRoutes({ ...q, type: p.probe.type, when: dateToWhen(p.probe.date) });
      const d = TimeShift.resolve(p, (data.routes || []).map((r) => r.summary));
      return { ...q, type: p.type, when: dateToWhen(d) };
    },
  });
}

// ---------- 前後のダイヤ ----------
// 経路の発車時刻をタップすると、その駅から目的地までの電車を一覧表示する。
// 乗換駅の場合は、そこまでの電車はそのままにして出発駅からの全体ルートを作る。
const MIN_MS = 60e3;
let dia = null;

function mainAccess(route) {
  return route.steps.find((s) => s.kind === 'access' && !s.walk) || route.steps.find((s) => s.kind === 'access') || null;
}

function openDia(routeIndex, stepIndex) {
  const q = shownQuery;
  const route = shownRoutes[routeIndex];
  if (!q || !route) return;
  const st = route.steps[stepIndex];
  const anchor = TimeShift.anchorFor(q.type, whenToDate(q.when));
  const originDep = TimeShift.nearDate(route.summary.dep, anchor);
  const stDep = originDep && TimeShift.nearDate(st.dep, originDep);
  if (!stDep) return;

  dia = {
    routeIndex,
    stepIndex,
    route,
    st,
    q: { ...q, from: st.name, via: stepIndex === 0 ? q.via : '', type: 'dep', coords: null },
    originName: route.steps[0].name,
    originDep,
    stDep,
    stArr: stepIndex > 0 && st.arr ? TimeShift.nearDate(st.arr, originDep) : null,
    entries: new Map(),
    nextT: new Date(+stDep - 30 * MIN_MS),
    earlierFrom: null,
    loading: false,
    scrolled: false,
  };
  $('diaRoute').textContent = `${st.name} → ${q.to}`;
  $('diaNote').textContent = stepIndex === 0
    ? '時刻によって前後のルートが変わることがあります。選ぶとそのルートに切り替わります。'
    : `${st.name}に${st.arr}着として、そこから先の電車を選べます。${dia.originName}からの全体の時刻も表示します。`;
  renderDia();
  $('diaDlg').showModal();
  loadDiaLater(5, +stDep + 60 * MIN_MS);
}

function addDiaEntries(d, routes, t) {
  for (const r of routes) {
    const dep = TimeShift.nearDate(r.summary.dep, t);
    let arr = dep && TimeShift.nearDate(r.summary.arr, dep);
    if (!dep || !arr) continue;
    if (arr < dep) arr = new Date(+arr + 24 * 3600e3);
    const a = mainAccess(r);
    const key = `${+dep}|${+arr}|${a ? a.line : ''}`;
    if (!d.entries.has(key)) d.entries.set(key, { route: r, dep, arr });
  }
}

// 後ろへ読み進める（読んだ中で最も遅い出発の 1 分後から次を検索）
async function loadDiaLater(maxRequests, until) {
  const d = dia;
  if (!d || d.loading) return;
  d.loading = true;
  renderDia();
  for (let i = 0; i < maxRequests; i++) {
    const t = d.nextT;
    const data = await fetchRoutes({ ...d.q, when: dateToWhen(t) });
    if (dia !== d) return;
    const routes = data.routes || [];
    addDiaEntries(d, routes, t);
    d.nextT = TimeShift.chainNext(routes.map((r) => r.summary), t);
    renderDia();
    if (until && +d.nextT > until) break;
  }
  d.loading = false;
  renderDia();
}

// 前へさかのぼる（40 分前から今の先頭まで読み直す）
async function loadDiaEarlier() {
  const d = dia;
  if (!d || d.loading) return;
  const firstDep = d.entries.size ? Math.min(...[...d.entries.values()].map((e) => +e.dep)) : +d.stDep;
  const limit = Math.min(firstDep, d.earlierFrom || Infinity);
  let t = new Date(limit - 40 * MIN_MS);
  d.earlierFrom = +t;
  d.loading = true;
  renderDia();
  for (let i = 0; i < 3 && +t < limit; i++) {
    const data = await fetchRoutes({ ...d.q, when: dateToWhen(t) });
    if (dia !== d) return;
    const routes = data.routes || [];
    addDiaEntries(d, routes, t);
    t = TimeShift.chainNext(routes.map((r) => r.summary), t);
    renderDia();
  }
  d.loading = false;
  renderDia();
}

function renderDia() {
  const d = dia;
  const list = $('diaList');
  list.textContent = '';
  if (!d) return;
  const pad2 = (dt) => `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

  const earlier = el('button', 'dia-more', d.loading ? '読み込み中…' : '▲ さらに前を表示');
  earlier.type = 'button';
  earlier.disabled = d.loading;
  earlier.addEventListener('click', loadDiaEarlier);
  list.append(earlier);

  const entries = [...d.entries.values()].sort((a, b) => a.dep - b.dep || a.arr - b.arr);
  let currentRow = null;
  for (const e of entries) {
    const r = e.route;
    const tooEarly = d.stArr && e.dep < d.stArr;
    const row = el('button', 'dia-row');
    row.type = 'button';
    row.disabled = !!tooEarly;
    const isCurrent = +e.dep === +d.stDep && !currentRow;
    if (isCurrent) { row.classList.add('current'); currentRow = row; }

    const times = el('div', 'dia-times');
    times.append(el('b', '', pad2(e.dep)), el('span', 'dia-arrow', '→'), el('b', '', pad2(e.arr)));
    const legMeta = [`(${TimeShift.formatMinutes((e.arr - e.dep) / MIN_MS)})`];
    if (r.summary.transfers != null) legMeta.push(`乗換${r.summary.transfers}回`);
    times.append(el('small', '', legMeta.join(' ')));
    row.append(times);

    const a = mainAccess(r);
    if (a) {
      row.append(el('div', 'dia-line', a.line + (a.destination ? `・${a.destination}` : '')));
      const plat = (a.platform || '').split('→')[0].trim();
      if (plat) row.append(el('div', 'dia-sub', plat));
    }
    if (tooEarly) {
      row.append(el('div', 'dia-note-row', `乗り継げません（${d.st.name} ${d.st.arr}着）`));
    } else if (d.stepIndex > 0) {
      row.append(el('div', 'dia-total',
        `全体：${d.originName} ${d.route.summary.dep}発 → ${pad2(e.arr)}着（${TimeShift.formatMinutes((e.arr - d.originDep) / MIN_MS)}）`));
    }
    if (isCurrent) row.append(el('div', 'dia-current', '表示中の電車'));
    row.addEventListener('click', () => chooseDia(e));
    list.append(row);
  }

  if (!entries.length && !d.loading) list.append(el('p', 'empty', '電車が見つかりませんでした'));

  const later = el('button', 'dia-more', d.loading ? '読み込み中…' : '▼ さらに後を表示');
  later.type = 'button';
  later.disabled = d.loading;
  later.addEventListener('click', () => loadDiaLater(3));
  list.append(later);

  if (currentRow && !d.scrolled) {
    d.scrolled = true;
    currentRow.scrollIntoView({ block: 'center' });
  }
}

function chooseDia(e) {
  const d = dia;
  if (!d) return;
  const combined = TimeShift.combineRoute(d.route, d.stepIndex, e.route);
  shownRoutes[d.routeIndex] = combined;
  const old = $('resultList').children[d.routeIndex];
  if (old) old.replaceWith(renderRoute(combined, d.routeIndex, true));
  $('diaDlg').close();
  toast(`${d.st.name} ${e.route.summary.dep}発に変更しました`);
}

// ---------- 履歴・お気に入り ----------
const routeKey = (r) => [r.from, r.via || '', r.to].join('\u0000');

function addHistory(q) {
  const item = { from: q.from, to: q.to, via: q.via || '' };
  recent = [item].concat(recent.filter((h) => routeKey(h) !== routeKey(item))).slice(0, 15);
  store.set('history', recent);
  renderLists();
}

function addFavorite(item) {
  if (favorites.some((f) => routeKey(f) === routeKey(item))) { toast('登録済みです'); return; }
  favorites.push(item);
  store.set('favorites', favorites);
  renderLists();
  toast('お気に入りに登録しました');
}

function routeLabel(r) {
  const frag = document.createDocumentFragment();
  frag.append(r.from || CURRENT_LOCATION);
  frag.append(el('span', 'arrow', '→'), r.to);
  if (r.via) frag.append(el('small', '', `${r.via} 経由`));
  return frag;
}

function fillRoute(r) {
  fromEl.value = r.from || '';
  toEl.value = r.to || '';
  fromCoords = null;
  if (r.via) {
    $('viaRow').hidden = false;
    viaEl.value = r.via;
  } else {
    $('viaRow').hidden = true;
    viaEl.value = '';
  }
}

function fillForm(q) {
  fillRoute(q);
  setType(q.type);
  whenEl.value = `${whenDate(q.when)}T${whenTime(q.when)}`;
  timeIsCustom = true;
}

function renderList(listEl, emptyEl, items, onDelete) {
  listEl.textContent = '';
  emptyEl.hidden = items.length > 0;
  items.forEach((r, i) => {
    const li = document.createElement('li');
    const go = el('button', 'go');
    go.type = 'button';
    go.append(routeLabel(r));
    go.addEventListener('click', () => {
      fillRoute(r);
      setType('dep');
      setNow();
      search();
    });
    const del = el('button', 'del', '✕');
    del.type = 'button';
    del.setAttribute('aria-label', '削除');
    del.addEventListener('click', () => onDelete(i));
    li.append(go, del);
    listEl.append(li);
  });
}

function renderLists() {
  renderList($('favList'), $('favEmpty'), favorites, (i) => {
    favorites.splice(i, 1);
    store.set('favorites', favorites);
    renderLists();
  });
  renderList($('histList'), $('histEmpty'), recent, (i) => {
    recent.splice(i, 1);
    store.set('history', recent);
    renderLists();
  });
  $('clearHistBtn').hidden = recent.length === 0;

  // 入力候補：お気に入りと履歴に出てきた駅名
  const names = new Set();
  favorites.concat(recent).forEach((r) => {
    [r.from, r.to, r.via].forEach((n) => { if (n && n !== CURRENT_LOCATION) names.add(n); });
  });
  const dl = $('stationList');
  dl.textContent = '';
  names.forEach((n) => {
    const opt = document.createElement('option');
    opt.value = n;
    dl.append(opt);
  });
}

// ---------- 現在地 ----------
async function nearestStations(lat, lng) {
  const res = await fetch('api/nearest?' + query({ lat, lng }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.stations || !data.stations.length) throw new Error(data.error || 'no station');
  return data.stations;
}

function getPosition(options) {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
}

function renderNearby(stations) {
  const row = $('nearbyRow');
  row.textContent = '';
  row.hidden = stations.length < 2;
  if (row.hidden) return;
  row.append(el('span', 'nearby-label', '近くの駅'));
  stations.forEach((st) => {
    const b = el('button', 'chip', st.name);
    b.type = 'button';
    b.title = `${st.lines.join('・')} ${st.distance}`;
    b.addEventListener('click', () => {
      fromEl.value = st.name;
      fromCoords = null;
      row.hidden = true;
    });
    row.append(b);
  });
}

async function useCurrentLocation() {
  if (!window.isSecureContext || !navigator.geolocation) {
    toast('このブラウザでは位置情報が使えません');
    return;
  }
  const btn = $('locBtn');
  btn.disabled = true;
  toast('現在地を取得中…');
  let pos;
  try {
    // まずは速い測位（Wi-Fi など）、だめなら GPS で再試行
    pos = await getPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 })
      .catch((e) => (e.code === 1 ? Promise.reject(e) : getPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })));
  } catch (e) {
    btn.disabled = false;
    if (e.code === 1) {
      toast('位置情報が許可されていません');
      $('locHelpDlg').showModal();
    } else {
      toast('現在地を特定できませんでした。少し移動してもう一度お試しください');
    }
    return;
  }

  const { latitude: lat, longitude: lng } = pos.coords;
  try {
    const stations = await nearestStations(lat, lng);
    fromEl.value = stations[0].name;
    fromCoords = null;
    renderNearby(stations);
    toast(`最寄り駅：${stations[0].name}（${stations[0].distance}）`);
  } catch (e) {
    fromEl.value = CURRENT_LOCATION;
    fromCoords = { lat: lat.toFixed(6), lng: lng.toFixed(6) };
    $('nearbyRow').hidden = true;
    toast('最寄り駅は取得できませんでした（地図アプリでは現在地から検索できます）');
  }
  btn.disabled = false;
}

// ---------- 設定 ----------
const OPT_IDS = { shin: 'optShin', ex: 'optEx', al: 'optAl', hb: 'optHb', lb: 'optLb', sr: 'optSr' };
const SELECT_IDS = { engine: 'engineSel', sort: 'sortSel', ticket: 'ticketSel', expkind: 'expkindSel', ws: 'wsSel' };

function renderEngineButtons() {
  $('goBtn').textContent = ENGINES[settings.engine].label;
  $('engineHint').textContent = ENGINES[settings.engine].hint;
  const alt = $('altEngines');
  alt.textContent = '';
  Object.keys(ENGINES).filter((k) => k !== settings.engine).forEach((k) => {
    const b = el('button', '', ALT_LABELS[k]);
    b.type = 'button';
    b.addEventListener('click', () => search(k));
    alt.append(b);
  });
}

function loadSettingsForm() {
  Object.entries(SELECT_IDS).forEach(([k, id]) => { $(id).value = settings[k]; });
  Object.entries(OPT_IDS).forEach(([k, id]) => { $(id).checked = !!settings[k]; });
  const base = location.origin + location.pathname;
  $('urlExample').textContent = `${base}?from=新宿&to=渋谷&go=1`;
}

function saveSettingsForm() {
  Object.entries(SELECT_IDS).forEach(([k, id]) => { settings[k] = $(id).value; });
  Object.entries(OPT_IDS).forEach(([k, id]) => { settings[k] = $(id).checked; });
  store.set('settings', settings);
  renderEngineButtons();
}

// ---------- トースト ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ---------- URL パラメータ ----------
// 例: ?from=新宿&to=渋谷&via=代々木&type=arr&date=2026-10-12&time=09:00&engine=apple&go=1
function queryFromUrl() {
  const p = new URLSearchParams(location.search);
  if (!p.get('to')) return null;
  const now = toLocalInputValue(new Date());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.get('date') || '') ? p.get('date') : now.slice(0, 10);
  const time = /^\d{1,2}:\d{2}$/.test(p.get('time') || '') ? p.get('time').padStart(5, '0') : now.slice(11);
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return {
    q: {
      from: (p.get('from') || '').trim(),
      to: p.get('to').trim(),
      via: (p.get('via') || '').trim(),
      type: TYPE_LABEL[p.get('type')] ? p.get('type') : 'dep',
      when: { y, mo, d, h, mi },
      coords: null,
    },
    go: p.get('go') === '1',
    engine: ENGINES[p.get('engine')] ? p.get('engine') : null,
  };
}

// initial: ページを開いたとき（true）／戻る・進む操作のとき（false）
function routeFromLocation(initial) {
  const parsed = queryFromUrl();
  if (!parsed) {
    showView('form');
    return;
  }
  const engine = parsed.engine || settings.engine;
  if (!initial) {
    // 戻る・進むでは結果だけ切り替え、ホームの入力欄はユーザーが入れたままにする
    if (parsed.go) showResults(parsed.q, false);
    else showView('form');
    return;
  }
  fillForm(parsed.q);
  if (!/^\d{1,2}:\d{2}$/.test(new URLSearchParams(location.search).get('time') || '')) timeIsCustom = false;
  if (parsed.go && engine === 'app') {
    showResults(parsed.q, false);
  } else if (parsed.go) {
    window.history.replaceState(null, '', location.pathname);
    search(engine);
  } else {
    showView('form');
  }
}

// ---------- 初期化 ----------
function init() {
  setNow();
  renderLists();
  renderEngineButtons();

  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); search(); });
  fromEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); toEl.focus(); }
  });
  fromEl.addEventListener('input', () => { fromCoords = null; $('nearbyRow').hidden = true; });
  $('swapBtn').addEventListener('click', () => {
    const a = fromEl.value;
    fromEl.value = toEl.value;
    toEl.value = a === CURRENT_LOCATION ? '' : a;
    fromCoords = null;
  });
  $('nowBtn').addEventListener('click', () => { setNow(); setType('dep'); });
  $('locBtn').addEventListener('click', useCurrentLocation);
  $('viaBtn').addEventListener('click', () => { $('viaRow').hidden = false; viaEl.focus(); });
  $('viaClose').addEventListener('click', () => { $('viaRow').hidden = true; viaEl.value = ''; });

  $('addFavBtn').addEventListener('click', () => {
    const q = currentQuery();
    if (!q.to) { toast('到着駅を入力してください'); return; }
    addFavorite({ from: q.from, to: q.to, via: q.via });
  });
  $('clearHistBtn').addEventListener('click', () => {
    if (!confirm('履歴をすべて消去しますか？')) return;
    recent = [];
    store.set('history', recent);
    renderLists();
  });

  // 結果画面
  $('backBtn').addEventListener('click', () => {
    window.history.pushState(null, '', location.pathname);
    showView('form');
  });
  $('earlierBtn').addEventListener('click', () => shiftSearch(-1));
  $('laterBtn').addEventListener('click', () => shiftSearch(1));
  $('favFromResultBtn').addEventListener('click', () => {
    if (shownQuery) addFavorite({ from: shownQuery.from, to: shownQuery.to, via: shownQuery.via });
  });
  window.addEventListener('popstate', () => routeFromLocation(false));

  const dlg = $('settingsDlg');
  $('settingsBtn').addEventListener('click', () => { loadSettingsForm(); dlg.showModal(); });
  dlg.addEventListener('change', saveSettingsForm);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  // 時刻を自分で指定していなければ、アプリに戻ってきたときに「今」に更新
  whenEl.addEventListener('input', () => { timeIsCustom = true; });
  const refreshNow = () => { if (!timeIsCustom && document.visibilityState === 'visible') setNow(); };
  window.addEventListener('pageshow', refreshNow);
  document.addEventListener('visibilitychange', refreshNow);

  $('diaClose').addEventListener('click', () => $('diaDlg').close());
  $('diaDlg').addEventListener('close', () => { dia = null; });
  $('diaDlg').addEventListener('click', (e) => { if (e.target === $('diaDlg')) $('diaDlg').close(); });

  routeFromLocation(true);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
