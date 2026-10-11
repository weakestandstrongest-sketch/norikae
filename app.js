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
  engine: 'apple',
  sort: '0',
  ticket: 'ic',
  shin: true, ex: true, al: true, hb: true, lb: true, sr: true,
};
let settings = Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
let favorites = store.get('favorites', []);
let recent = store.get('history', []);

const ENGINES = {
  apple: { label: 'Apple マップ', hint: 'Apple マップで開きます（広告なし・日時指定は地図アプリ側で変更）' },
  google: { label: 'Google マップ', hint: 'Google マップで開きます（広告なし）' },
  yahooPrint: { label: 'Yahoo 印刷版', hint: 'Yahoo!乗換案内の印刷用ページで開きます（通常版より広告が少ない）' },
  yahoo: { label: 'Yahoo 通常版', hint: 'Yahoo!乗換案内の通常ページで開きます' },
};

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
function setNow() { whenEl.value = toLocalInputValue(new Date()); }
function readWhen() {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(whenEl.value);
  if (!m) { setNow(); return readWhen(); }
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}
function isNearNow(w) {
  const t = new Date(w.y, w.mo - 1, w.d, w.h, w.mi).getTime();
  return Math.abs(t - Date.now()) < 5 * 60 * 1000;
}
function getType() {
  return document.querySelector('input[name="type"]:checked').value;
}
function setType(v) {
  const el = document.querySelector(`input[name="type"][value="${v}"]`);
  if (el) el.checked = true;
}

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

  // Yahoo!乗換案内
  const typeCode = { dep: 1, arr: 4, first: 3, last: 2 }[q.type];
  const flag = (b) => (b ? 1 : 0);
  const path = engine === 'yahooPrint' ? 'print' : 'result';
  return `https://transit.yahoo.co.jp/search/${path}?` + query({
    from: q.from,
    to: q.to,
    via: q.via,
    y: w.y,
    m: pad(w.mo),
    d: pad(w.d),
    hh: pad(w.h),
    m1: Math.floor(w.mi / 10),
    m2: w.mi % 10,
    type: typeCode,
    ticket: settings.ticket,
    expkind: 1,
    userpass: 1,
    ws: 3,
    s: settings.sort,
    al: flag(settings.al),
    shin: flag(settings.shin),
    ex: flag(settings.ex),
    hb: flag(settings.hb),
    lb: flag(settings.lb),
    sr: flag(settings.sr),
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
  const q = currentQuery();
  const isYahoo = engine.startsWith('yahoo');

  if (!q.to) { toast('到着駅を入力してください'); toEl.focus(); return; }
  if (isYahoo && (!q.from || q.from === CURRENT_LOCATION)) {
    toast('Yahoo では出発駅の入力が必要です');
    fromEl.focus();
    return;
  }
  if (!q.from && !isYahoo) q.from = CURRENT_LOCATION;

  addHistory(q);
  location.href = buildUrl(engine, q);
}

// ---------- 履歴・お気に入り ----------
const routeKey = (r) => [r.from, r.via || '', r.to].join('\u0000');

function addHistory(q) {
  const item = { from: q.from, to: q.to, via: q.via || '' };
  recent = [item].concat(recent.filter((h) => routeKey(h) !== routeKey(item))).slice(0, 15);
  store.set('history', recent);
  renderLists();
}

function routeLabel(r) {
  const frag = document.createDocumentFragment();
  frag.append(r.from || CURRENT_LOCATION);
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = '→';
  frag.append(arrow, r.to);
  if (r.via) {
    const small = document.createElement('small');
    small.textContent = `${r.via} 経由`;
    frag.append(small);
  }
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

function renderList(listEl, emptyEl, items, onDelete) {
  listEl.textContent = '';
  emptyEl.hidden = items.length > 0;
  items.forEach((r, i) => {
    const li = document.createElement('li');
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'go';
    go.append(routeLabel(r));
    go.addEventListener('click', () => {
      fillRoute(r);
      setType('dep');
      setNow();
      search();
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.setAttribute('aria-label', '削除');
    del.textContent = '✕';
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
function nearestStation(lat, lng) {
  // HeartRails Express API（JSONP）で最寄り駅を取得
  return new Promise((resolve, reject) => {
    const cb = '__norikae_cb_' + Date.now();
    const script = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 8000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    }
    window[cb] = (data) => {
      cleanup();
      const list = data && data.response && data.response.station;
      if (list && list.length) resolve(list[0]);
      else reject(new Error('no station'));
    };
    script.onerror = () => { cleanup(); reject(new Error('load error')); };
    script.src = 'https://express.heartrails.com/api/json?' + query({ method: 'getStations', x: lng, y: lat, jsonp: cb });
    document.head.append(script);
  });
}

function useCurrentLocation() {
  if (!navigator.geolocation) { toast('位置情報が使えません'); return; }
  const btn = $('locBtn');
  btn.disabled = true;
  toast('現在地を取得中…');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lng } = pos.coords;
    try {
      const st = await nearestStation(lat, lng);
      fromEl.value = st.name;
      fromCoords = null;
      toast(`最寄り駅：${st.name}（${st.line}・${st.distance}）`);
    } catch (e) {
      fromEl.value = CURRENT_LOCATION;
      fromCoords = { lat: lat.toFixed(6), lng: lng.toFixed(6) };
      toast('最寄り駅は取得できませんでした（地図アプリでは現在地から検索します）');
    }
    btn.disabled = false;
  }, () => {
    btn.disabled = false;
    toast('位置情報を取得できませんでした');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

// ---------- 設定 ----------
const OPT_IDS = { shin: 'optShin', ex: 'optEx', al: 'optAl', hb: 'optHb', lb: 'optLb', sr: 'optSr' };

function renderEngineButtons() {
  $('goBtn').textContent = `${ENGINES[settings.engine].label}で検索`;
  $('engineHint').textContent = ENGINES[settings.engine].hint;
  const alt = $('altEngines');
  alt.textContent = '';
  Object.keys(ENGINES).filter((k) => k !== settings.engine).forEach((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = ENGINES[k].label;
    b.addEventListener('click', () => search(k));
    alt.append(b);
  });
}

function loadSettingsForm() {
  $('engineSel').value = settings.engine;
  $('sortSel').value = settings.sort;
  $('ticketSel').value = settings.ticket;
  Object.entries(OPT_IDS).forEach(([k, id]) => { $(id).checked = !!settings[k]; });
  const base = location.origin + location.pathname;
  $('urlExample').textContent = `${base}?from=新宿&to=渋谷&go=1`;
}

function saveSettingsForm() {
  settings.engine = $('engineSel').value;
  settings.sort = $('sortSel').value;
  settings.ticket = $('ticketSel').value;
  Object.entries(OPT_IDS).forEach(([k, id]) => { settings[k] = $(id).checked; });
  store.set('settings', settings);
  renderEngineButtons();
}

// ---------- トースト ----------
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ---------- URL パラメータ ----------
// 例: ?from=新宿&to=渋谷&via=代々木&type=arr&date=2026-10-12&time=09:00&engine=yahooPrint&go=1
function applyUrlParams() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].length) return false;
  if (p.get('from')) fromEl.value = p.get('from');
  if (p.get('to')) toEl.value = p.get('to');
  if (p.get('via')) { $('viaRow').hidden = false; viaEl.value = p.get('via'); }
  if (p.get('type')) setType(p.get('type'));
  const now = new Date();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.get('date') || '') ? p.get('date') : toLocalInputValue(now).slice(0, 10);
  const time = /^\d{1,2}:\d{2}$/.test(p.get('time') || '') ? p.get('time').padStart(5, '0') : toLocalInputValue(now).slice(11);
  whenEl.value = `${date}T${time}`;

  const engine = p.get('engine');
  // 履歴を汚さないよう、パラメータはアドレスバーから消しておく
  window.history.replaceState(null, '', location.pathname);
  if (p.get('go') === '1' && toEl.value) {
    search(ENGINES[engine] ? engine : undefined);
    return true;
  }
  return false;
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
  fromEl.addEventListener('input', () => { fromCoords = null; });
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
    const item = { from: q.from, to: q.to, via: q.via };
    if (favorites.some((f) => routeKey(f) === routeKey(item))) { toast('登録済みです'); return; }
    favorites.push(item);
    store.set('favorites', favorites);
    renderLists();
    toast('お気に入りに登録しました');
  });
  $('clearHistBtn').addEventListener('click', () => {
    if (!confirm('履歴をすべて消去しますか？')) return;
    recent = [];
    store.set('history', recent);
    renderLists();
  });

  const dlg = $('settingsDlg');
  $('settingsBtn').addEventListener('click', () => { loadSettingsForm(); dlg.showModal(); });
  dlg.addEventListener('change', saveSettingsForm);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  // 戻るボタンで戻ってきたときは時刻を今に更新
  window.addEventListener('pageshow', (e) => { if (e.persisted) setNow(); });

  applyUrlParams();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
