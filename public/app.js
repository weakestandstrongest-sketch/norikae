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
 * opts.tries に複数の条件を渡すと順に検索し、opts.accept を満たした最初の結果を表示する
 * （前後の電車が見つかるまで少しずつ時間を広げるため）。
 */
async function showResults(q, push, opts = {}) {
  const tries = opts.tries || [q];
  const accept = opts.accept || (() => true);
  shownQuery = tries[0];
  if (push) window.history.pushState({ view: 'result' }, '', resultUrl(tries[0]));
  showView('result');
  renderResultHead(tries[0]);

  const list = $('resultList');
  list.textContent = '';
  list.append(el('p', 'loading', '検索中…'));
  const seq = ++searchSeq;
  shownRoutes = [];
  resultLoading = true;

  let data;
  let used = tries[0];
  for (const t of tries) {
    data = await fetchRoutes(t);
    if (seq !== searchSeq) return; // 新しい検索が始まっていたら捨てる
    used = t;
    if (data.routes && data.routes.length && accept(data.routes.map((r) => r.summary))) break;
  }
  resultLoading = false;
  if (used !== tries[0]) {
    shownQuery = used;
    window.history.replaceState(window.history.state, '', resultUrl(used));
    renderResultHead(used);
  }

  list.textContent = '';
  if (!data.routes || !data.routes.length) {
    const box = el('div', 'card error');
    box.append(el('p', '', data.error || '経路が見つかりませんでした'));
    const retry = el('button', 'chip', '再読み込み');
    retry.type = 'button';
    retry.addEventListener('click', () => showResults(used, false));
    box.append(retry);
    list.append(box);
    return;
  }
  shownRoutes = data.routes;
  data.routes.forEach((r, i) => list.append(renderRoute(r, i)));
}

function renderRoute(route, index) {
  const s = route.summary;
  const card = el('article', 'card route');

  const head = el('button', 'route-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', index === 0 ? 'true' : 'false');

  const tags = el('div', 'tags');
  tags.append(el('span', 'route-no', `ルート${index + 1}`));
  s.tags.forEach((t) => tags.append(el('span', `tag tag-${{ 早: 'fast', 安: 'cheap', 楽: 'easy' }[t] || 'other'}`, t)));
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

  const detail = renderSteps(route.steps);
  if (index === 0) detail.append(el('li', 'tl-hint', '発車時刻をタップすると、その駅から1本後の電車で調べ直せます'));
  detail.hidden = index !== 0;
  head.addEventListener('click', () => {
    detail.hidden = !detail.hidden;
    head.setAttribute('aria-expanded', String(!detail.hidden));
  });

  card.append(head, detail);
  return card;
}

function renderSteps(steps) {
  const ol = el('ol', 'timeline');
  steps.forEach((st, i) => {
    if (st.kind === 'station') {
      const li = el('li', 'tl-station');
      const time = el('div', 'tl-time');
      if (st.arr) time.append(el('span', '', `${st.arr}着`));
      if (st.dep) {
        const dep = el('button', 'tl-dep', `${st.dep}発`);
        dep.type = 'button';
        dep.setAttribute('aria-label', `${st.name} ${st.dep}発 の1本後で調べ直す`);
        dep.addEventListener('click', () => openStepMenu(st));
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

// 前後の時間で再検索（ホームの入力欄はそのまま）
function shiftSearch(direction) {
  const q = shownQuery;
  if (!q || resultLoading) return;
  const p = TimeShift.plan(direction, q.type, whenToDate(q.when), shownRoutes.map((r) => r.summary));
  const tries = p.dates.map((d) => ({ ...q, type: p.type, when: dateToWhen(d) }));
  showResults(tries[0], true, { tries, accept: p.accept });
}

// 経路の途中の発車時刻をタップ：その駅から1本後の電車で調べ直す
let stepTarget = null;
function openStepMenu(st) {
  const q = shownQuery;
  if (!q) return;
  stepTarget = st;
  $('stepTitle').textContent = `${st.name} ${st.dep}発`;
  $('stepDesc').textContent = `この電車に乗れなかったら？ ${st.name} から ${q.to} まで、次の電車で調べ直します。`;
  $('stepDlg').showModal();
}

function searchNextTrainFromStep() {
  const q = shownQuery;
  const st = stepTarget;
  $('stepDlg').close();
  if (!q || !st) return;
  const d = TimeShift.nextTrainFrom(st.dep, q.type, whenToDate(q.when));
  if (!d) return;
  showResults({ ...q, from: st.name, via: '', type: 'dep', when: dateToWhen(d), coords: null }, true);
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

  $('stepNextBtn').addEventListener('click', searchNextTrainFromStep);
  $('stepDlg').addEventListener('click', (e) => { if (e.target === $('stepDlg')) $('stepDlg').close(); });

  routeFromLocation(true);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
