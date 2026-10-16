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
const VIA_SEP = '、';
const MAX_VIA = 3;
const splitVia = (v) => (v || '').split(VIA_SEP).map((x) => x.trim()).filter(Boolean).slice(0, MAX_VIA);
const whenEl = $('when');
let fromCoords = null; // 現在地を使ったときの座標（label は出発欄に入れた住所）

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
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function originFor(q) {
  if (q.from === CURRENT_LOCATION || q.from === '' || (q.coords && q.coords.label === q.from)) {
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
    via: splitVia(q.via),
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
    from: p.from, to: p.to, via: p.via,  // 経由駅は複数可（via=A&via=B）
    y: w.y, m: pad(w.mo), d: pad(w.d), hh: pad(w.h), m1: Math.floor(w.mi / 10), m2: w.mi % 10,
    type: typeCode, ticket: p.ticket, expkind: p.expkind, userpass: 1, ws: p.ws, s: p.s,
    al: p.al, shin: p.shin, ex: p.ex, hb: p.hb, lb: p.lb, sr: p.sr,
  });
}

// ---------- 経由駅（最大 3 つ） ----------
function viaInputs() {
  return [...document.querySelectorAll('#viaList input')];
}

function setVias(values) {
  const list = $('viaList');
  list.textContent = '';
  values.slice(0, MAX_VIA).forEach((v, i) => {
    const row = el('div', 'station-row via-row');
    row.append(el('span', 'dot via'));
    const input = el('input');
    input.type = 'text';
    input.placeholder = `経由駅${values.length > 1 ? i + 1 : ''}`;
    input.setAttribute('enterkeyhint', 'next');
    input.value = v;
    const del = el('button', 'chip', '✕');
    del.type = 'button';
    del.setAttribute('aria-label', '経由を削除');
    del.addEventListener('click', () => {
      const rest = viaInputs().map((x) => x.value);
      rest.splice(i, 1);
      setVias(rest);
    });
    row.append(input, del);
    list.append(row);
  });
  $('viaBtn').hidden = values.length >= MAX_VIA;
}

// 検索結果に出てきた駅名を覚えて、入力候補に出す（最大 150 件）
function rememberStations(routes) {
  const seen = store.get('seenStations', []);
  const set = new Set(seen);
  for (const r of routes) {
    for (const st of r.steps) {
      if (st.kind === 'station' && st.isStation && st.name) set.add(st.name); // 「則武本郷/岐阜バス」などのバス停も覚える
    }
  }
  if (set.size === seen.length) return;
  store.set('seenStations', [...set].slice(-150));
  renderLists();
}

// ---------- 検索 ----------
function currentQuery() {
  return {
    from: fromEl.value.trim(),
    to: toEl.value.trim(),
    via: viaInputs().map((i) => i.value.trim()).filter(Boolean).join(VIA_SEP),
    type: getType(),
    when: readWhen(),
    coords: fromCoords,
  };
}

function search(engine) {
  engine = engine || settings.engine;
  if (!timeIsCustom) setNow(); // 「今」のまま時間がたっていたら最新の時刻で検索
  hideSugg();
  if (engine === 'app' || engine === 'yahoo') resolveBusStops();
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
  $('resultRoute').textContent = `${q.from} → ${q.to}` + (q.via ? `（${splitVia(q.via).join('・')} 経由）` : '');
  const w = q.when;
  const wd = '日月火水木金土'[whenToDate(w).getDay()];
  $('resultWhen').textContent = q.type === 'first' || q.type === 'last'
    ? `${w.mo}/${w.d}（${wd}）${TYPE_LABEL[q.type]}`
    : `${w.mo}/${w.d}（${wd}）${whenTime(w)} ${TYPE_LABEL[q.type]}`;
  $('openYahoo').href = buildUrl('yahoo', q);
  $('openApple').href = buildUrl('apple', q);
  $('openGoogle').href = buildUrl('google', q);
}

async function fetchRoutes(q, page) {
  try {
    const res = await fetch('api/search?' + query({ ...yahooParams(q), page }));
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
  if (!opts.soft) showView('result');
  renderResultHead(q);

  const list = $('resultList');
  if (opts.soft) list.classList.add('refreshing');
  else { list.textContent = ''; list.append(el('p', 'loading', '検索中…')); }
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
  if (list.classList.contains('refreshing')) { list.classList.remove('refreshing'); list.classList.remove('fadein'); void list.offsetWidth; list.classList.add('fadein'); }
  const alt = altCard(q, data.alt);
  if (alt) list.append(alt);
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
  rememberStations(data.routes);
  if (data.total > data.routes.length) list.append(moreRoutesButton(q, seq, 2, data.total));
}

// Yahoo は 1 ページに 3 ルート。「ほかのルート」で 4 件目以降を読み足す
function moreRoutesButton(q, seq, page, total) {
  const b = el('button', 'dia-more more-routes', `ほかのルートを表示（${(page - 1) * 3 + 1}〜${Math.min(page * 3, total)}件目）`);
  b.type = 'button';
  b.addEventListener('click', async () => {
    b.disabled = true;
    b.textContent = '読み込み中…';
    const data = await fetchRoutes(q, page);
    if (seq !== searchSeq) return;
    const routes = (data.routes || []).filter((r) => !shownRoutes.some((s) =>
      s.summary.dep === r.summary.dep && s.summary.arr === r.summary.arr && s.steps.length === r.steps.length));
    if (!routes.length) { b.remove(); toast('ほかのルートはありませんでした'); return; }
    const list = $('resultList');
    routes.forEach((r) => {
      shownRoutes.push(r);
      list.insertBefore(renderRoute(r, shownRoutes.length - 1, false), b);
    });
    if (page < 3 && total > page * 3) {
      b.replaceWith(moreRoutesButton(q, seq, page + 1, total));
    } else {
      b.remove();
    }
  });
  return b;
}

// ---------- ひび手帳の中で開いたとき（?embed=hibi） ----------
// ひび手帳の予定シートの中に埋め込まれたときだけ、見た目をひび手帳に合わせ、
// 各ルートに「タイムラインに追加」ボタンを出して、選んだ経路を親の画面へ送る。
const HIBI = (() => {
  const p = new URLSearchParams(location.search);
  let cfg = null;
  try { cfg = JSON.parse(sessionStorage.getItem('norikae:hibi') || 'null'); } catch (e) { /* なし */ }
  if (p.get('embed') === 'hibi') {
    const parent = p.get('parent') || '';
    cfg = {
      parent: /^https:\/\/[a-z0-9-]+\.github\.io$/i.test(parent) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(parent) ? parent : '',
      theme: p.get('theme') === 'dark' ? 'dark' : 'light',
      accent: /^#[0-9a-f]{6}$/i.test(p.get('accent') || '') ? p.get('accent') : '',
      date: /^\d{4}-\d{2}-\d{2}$/.test(p.get('date') || '') ? p.get('date') : '',
      time: /^\d{1,2}:\d{2}$/.test(p.get('time') || '') ? p.get('time').padStart(5, '0') : '',
    };
    try { sessionStorage.setItem('norikae:hibi', JSON.stringify(cfg)); } catch (e) { /* 保存できなくても動作は続ける */ }
  }
  if (!cfg || window.parent === window) return null;
  const root = document.documentElement;
  root.classList.add('hibi');
  if (cfg.theme === 'dark') root.classList.add('dark');
  if (cfg.accent) root.style.setProperty('--hibi-accent', cfg.accent);
  let link = document.getElementById('hibiCss'); // index.html の先頭で読み込み済みのはず
  if (!link) {
    root.classList.add('hibi-wait');
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'hibi.css?v=18';
    link.id = 'hibiCss';
    document.head.append(link);
  }
  // ひび手帳の見た目が整ってから画面を見せ、親に「開けた」と知らせる（親はそれまで読み込み中の表示を出している）
  const tell = (type) => { try { window.parent.postMessage({ type }, cfg.parent || '*'); } catch (e) { /* 親がいない */ } };
  const ready = () => requestAnimationFrame(() => requestAnimationFrame(() => { root.classList.remove('hibi-wait'); tell('hibi:ready'); }));
  const styled = () => getComputedStyle(root).getPropertyValue('--hibi-loaded').trim() === '1';
  const check = () => (styled() ? ready() : tell('hibi:fail'));
  const state = root.getAttribute('data-hibi-css');
  if (styled()) setTimeout(ready, 0);
  else if (state) tell('hibi:fail'); // 読み込みは終わったのに見た目が変わっていない（失敗・古いファイル）
  else {
    link.addEventListener('load', check);
    link.addEventListener('error', () => tell('hibi:fail'));
  }
  settings.engine = 'app'; // 地図アプリなどへは埋め込みの中から移動できないので、アプリ内検索だけにする
  return cfg;
})();

function hibiPayload(route) {
  const q = shownQuery || currentQuery();
  const s = route.summary;
  const stations = route.steps.filter((x) => x.kind === 'station');
  return {
    v: 1,
    from: (stations[0] && stations[0].name) || q.from,
    to: (stations[stations.length - 1] && stations[stations.length - 1].name) || q.to,
    via: q.via || '',
    date: whenDate(q.when),
    dep: s.dep,
    arr: s.arr,
    duration: s.duration || '',
    transfers: s.transfers,
    fare: s.fare,
    fareNote: s.fareNote || '',
    tags: s.tags || [],
    steps: route.steps.map((st) => (st.kind === 'station'
      ? { k: 's', name: st.name, arr: st.arr || '', dep: st.dep || '' }
      : {
        k: 'a', line: st.line || '', dest: st.destination || '', color: st.color || '', walk: !!st.walk,
        platform: st.platform || '', stops: st.stops || '',
        stopList: (st.stopList || []).map((x) => ({ time: x.time, name: x.name })),
      })),
  };
}

function hibiAddButton(route) {
  const b = el('button', 'hibi-add', '＋ ひび手帳のタイムラインに追加');
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    window.parent.postMessage({ type: 'hibi:addRoute', route: hibiPayload(route) }, HIBI.parent || '*');
    b.disabled = true;
    b.textContent = '追加しました';
  });
  return b;
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
  if (s.fare != null) parts.push(`${s.fareNote === '目安' ? '約' : ''}${s.fare.toLocaleString('ja-JP')}円`);
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
  if (HIBI) card.append(hibiAddButton(route));
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
      if (st.walk) {
        const map = walkMapLink(steps[i - 1], steps[i + 1], i === 1);
        if (map) body.append(map);
      }
      const sub = el('div', 'tl-sub');
      if (st.platform) sub.append(st.platform);
      if (st.stops && st.stopList && st.stopList.length) {
        // 「24駅」をタップすると途中の駅・バス停を開く
        if (st.platform) sub.append(' ・ ');
        const toggle = el('button', 'tl-stops-btn', `${st.stops} ▾`);
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', 'false');
        const ul = el('ul', 'tl-stoplist');
        ul.hidden = true;
        st.stopList.forEach((x) => {
          const li = el('li');
          li.append(el('span', 'tl-stop-time', x.time), el('span', 'tl-stop-name', x.name));
          ul.append(li);
        });
        toggle.addEventListener('click', () => {
          ul.hidden = !ul.hidden;
          toggle.setAttribute('aria-expanded', String(!ul.hidden));
          toggle.textContent = `${st.stops} ${ul.hidden ? '▾' : '▴'}`;
        });
        sub.append(toggle);
        body.append(sub, ul);
      } else {
        if (st.stops) sub.append(`${st.platform ? ' ・ ' : ''}${st.stops}`);
        if (sub.textContent) body.append(sub);
      }
      if (st.alert) body.append(el('div', 'tl-alert', `⚠ ${st.alertText || '運行情報あり'}`));
      li.append(el('div', 'tl-time'), mark, body);
      ol.append(li);
    }
  });
  return ol;
}

// 地図アプリで使える地名（駅は「〇〇駅」にする。「赤池(愛知県)」の括弧は外す）
function placeForMap(st) {
  if (!st || !st.name) return '';
  if (st.name.includes('/')) return `${st.name.split('/')[0]} バス停`;
  if (!st.isStation) return st.name;
  const n = st.name.replace(/[（(][^)）]*[)）]/g, '').trim();
  return n.endsWith('駅') ? n : n + '駅';
}

// 徒歩区間の道順を Google マップで開くリンク
function walkMapLink(fromSt, toSt, isFirst) {
  const q = shownQuery;
  let origin = placeForMap(fromSt);
  // 現在地の住所から出発したときは、住所より正確な座標を使う
  if (isFirst && q && q.coords && q.coords.label === q.from) origin = `${q.coords.lat},${q.coords.lng}`;
  const destination = placeForMap(toSt);
  if (!origin || !destination) return null;
  const a = el('a', 'tl-map', 'Google マップで道順を見る ›');
  a.href = 'https://www.google.com/maps/dir/?' + query({ api: 1, origin, destination, travelmode: 'walking' });
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
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
    // 最初に乗る駅（その前が徒歩だけ）なら、家などを出る時刻を電車に合わせてずらせるので制限なし
    walkOnly: TimeShift.isWalkOnlyBefore(route, stepIndex),
    stArr: stepIndex > 0 && st.arr && !TimeShift.isWalkOnlyBefore(route, stepIndex) ? TimeShift.nearDate(st.arr, originDep) : null,
    entries: new Map(),
    nextT: new Date(+stDep - 30 * MIN_MS),
    earlierFrom: null,
    loading: false,
    scrolled: false,
  };
  $('diaRoute').textContent = `${st.name} → ${q.to}`;
  $('diaNote').textContent = stepIndex === 0
    ? '時刻によって前後のルートが変わることがあります。選ぶとそのルートに切り替わります。'
    : dia.walkOnly
      ? `${dia.originName}から${st.name}まで歩いて乗る電車を選べます。${dia.originName}を出る時刻も電車に合わせて表示します。`
      : `${st.name}に${st.arr}着として、そこから先の電車を選べます。${dia.originName}からの全体の時刻も表示します。`;
  // 乗る電車の駅コードが分かれば、駅の時刻表から全部の電車を出す
  const next = route.steps[stepIndex + 1];
  if (st.code && next && next.kind === 'access' && !next.walk) {
    dia.mode = 'timetable';
    dia.train = next;
    renderDia();
    $('diaDlg').showModal();
    startTimetableDia(dia);
    return;
  }
  dia.mode = 'chain';
  renderDia();
  $('diaDlg').showModal();
  loadDiaLater(5, +stDep + 60 * MIN_MS);
}

// ---------- 前後のダイヤ（駅の時刻表から） ----------
// 時刻表の全列車を並べ、1 本ずつ「その電車でその時刻に出たら何時に着くか」を検索する。

const ttDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function startTimetableDia(d) {
  // 深夜 0〜3 時台は前日の時刻表（24 時台）に載っている
  const service = new Date(d.stDep);
  if (service.getHours() < 4) service.setDate(service.getDate() - 1);
  service.setHours(0, 0, 0, 0);
  d.serviceDay = service;
  d.stMin = Math.round((d.stDep - service) / MIN_MS);
  d.loading = true;
  renderDia();
  try {
    const res = await fetch('api/timetable?' + query({
      code: d.st.code,
      date: ttDateStr(service),
      time: d.st.dep,
      line: d.train.line,
      dest: d.train.destination,
    }));
    const data = await res.json();
    if (dia !== d) return;
    if (!res.ok || !data.trains || !data.trains.length) throw new Error(data.error || 'no timetable');
    d.tt = data;
    d.rows = new Map();
    d.from = d.stMin - 30;
    d.to = d.stMin + 60;
    d.loading = false;
    fillTimetableRows(d);
  } catch (e) {
    if (dia !== d) return;
    // 時刻表が使えないときは、検索結果をつなげる方法に切り替える
    d.mode = 'chain';
    d.loading = false;
    loadDiaLater(5, +d.stDep + 60 * MIN_MS);
  }
}

// 表示範囲の列車を行にして、到着時刻を検索する
function fillTimetableRows(d) {
  for (const t of d.tt.trains) {
    if (t.min < d.from || t.min > d.to) continue;
    const key = `${t.trainId}|${t.min}`;
    if (d.rows.has(key)) continue;
    const dep = new Date(+d.serviceDay + t.min * MIN_MS);
    const row = { train: t, dep, state: 'pending', route: null, arr: null, exact: false };
    // 乗換駅に着く前に出てしまう電車は検索しない
    if (d.stArr && dep < d.stArr) row.state = 'tooEarly';
    d.rows.set(key, row);
  }
  renderDia();
  runTimetableSearches(d);
}

// 今の電車に近いものから順に、3 本ずつ並行して検索
async function runTimetableSearches(d) {
  if (d.searching) return;
  d.searching = true;
  const next = () => [...d.rows.values()]
    .filter((r) => r.state === 'pending')
    .sort((a, b) => Math.abs(a.dep - d.stDep) - Math.abs(b.dep - d.stDep))[0];
  const worker = async () => {
    for (let row = next(); row && dia === d; row = next()) {
      row.state = 'loading';
      const data = await fetchRoutes({ ...d.q, type: 'dep', when: dateToWhen(row.dep) });
      if (dia !== d) return;
      resolveTimetableRow(d, row, (data && data.routes) || []);
      renderDia();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  d.searching = false;
}

const normText = (s) => (s || '').normalize('NFKC').replace(/\s+/g, '').replace(/[(（][^)）]*[)）]/g, '');

// 検索結果の中から「この電車で出発するルート」を探す。なければ最短の到着を目安にする
function resolveTimetableRow(d, row, routes) {
  const t = row.train;
  const dest = normText(t.destination);
  const exact = routes.find((r) => {
    const first = r.steps[0];
    const a = r.steps.find((s) => s.kind === 'access');
    if (!first || first.dep !== t.time || !a || a.walk) return false;
    const line = normText(a.line);
    const kindOk = !t.kind || line.endsWith(normText(t.kind)) || (t.kind === '普通' && !/(急|快|特|準)/.test(line.slice(-4)));
    const destOk = !dest || normText(a.destination).startsWith(dest);
    return kindOk && destOk;
  });
  const arrOf = (r) => {
    let a = TimeShift.nearDate(r.summary.arr, row.dep);
    if (a && a < row.dep) a = new Date(+a + 24 * 3600e3);
    return a;
  };
  row.searchRoutes = routes;
  if (exact) {
    row.route = exact;
    row.arr = arrOf(exact);
    row.exact = true;
  } else {
    // この電車の時刻以降に出るルートのうち、最も早く着くもの
    const arrs = routes
      .filter((r) => { const dep = TimeShift.nearDate(r.summary.dep, row.dep); return dep && dep >= row.dep; })
      .map(arrOf).filter(Boolean);
    row.arr = arrs.length ? new Date(Math.min(...arrs)) : null;
  }
  row.state = 'done';
}

// 「全体：出発地 ◯◯発 → ◯◯着」の文。最初に乗る駅なら出発地を出る時刻も電車に合わせる
function diaTotalText(d, dep, arr) {
  const leave = d.walkOnly ? new Date(+d.originDep + (dep - d.stDep)) : d.originDep;
  const hm = (dt) => `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  return `全体：${d.originName} ${hm(leave)}発 → ${hm(arr)}着（${TimeShift.formatMinutes((arr - leave) / MIN_MS)}）`;
}

// ---------- 時刻表の電車から経路を作る ----------
// Yahoo の検索ではその電車を使う経路が出なかったとき（同じ時刻に着く後の電車が優先される）、
// 列車の停車駅を調べ、どこかで乗り換えて目的地に一番早く着く経路を組み立てる。

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

// その電車の経路を「途中のどこで乗り換えるか」ごとに作り、早い・安い・乗換が少ないなどから選べるようにする
async function buildTrainRoute(d, row) {
  if (row.building) return;
  row.building = true;
  row.error = null;
  renderDia();
  try {
    const options = await buildTrainOptions(d, row);
    if (dia !== d) return;
    row.building = false;
    if (!options.length) throw new Error('この電車を使う経路が見つかりませんでした');
    d.view = { row, options };
    renderDia();
    $('diaList').scrollTop = 0;
  } catch (e) {
    row.building = false;
    if (dia !== d) return;
    // 失敗の理由は一覧の中に出す（画面下の通知はダイヤの画面に隠れて見えないため）
    row.error = {
      message: e.message || 'エラー',
      report: JSON.stringify({ error: e.message, train: row.train, station: d.st, group: d.tt.groupId, kind: d.tt.kind, detail: e.detail || null }),
    };
    renderDia();
  }
}

// 路線名の頭（「名鉄」「JR」など）。同じ会社で乗り継ぐと運賃は通しになるので、足し算は目安になる
const companyOf = (line) => normText(line).replace(/^(JR|名鉄|近鉄|京王|東急|小田急|京急|京成|西武|東武|南海|阪急|阪神|京阪|西鉄|東京メトロ|都営|大阪メトロ).*/, '$1').slice(0, 4);
const firstTrainLine = (r) => { const a = r.steps.find((s) => s.kind === 'access' && !s.walk); return a ? a.line : ''; };

async function buildTrainOptions(d, row) {
  const t = row.train;
  const options = [];
  const add = (route, fare, fareApprox, via, sameCompany = false) => {
    let arr = TimeShift.nearDate(route.summary.arr, row.dep);
    if (arr && arr < row.dep) arr = new Date(+arr + 24 * 3600e3);
    if (!arr) return;
    route.summary.fare = fare;
    route.summary.fareNote = fareApprox ? '目安' : '';
    options.push({ route, arr, fare, fareApprox, sameCompany, transfers: route.summary.transfers == null ? 9 : route.summary.transfers, via });
  };

  // 1) Yahoo の検索結果にそのままこの電車を使う経路があれば、それも候補に（運賃も正確）
  for (const r of row.searchRoutes || []) {
    if (r.steps[0] && r.steps[0].dep === t.time && isSameTrain(r, t)) add(r, r.summary.fare, false, '');
  }

  // 2) 列車の停車駅を調べ、途中の駅で乗り換えた場合をそれぞれ検索する
  const res = await fetch('api/train?' + query({
    code: d.st.code, group: d.tt.groupId, train: t.trainId, kind: d.tt.kind || '',
    hh: Math.floor(t.min / 60), mm: t.min % 60,
  }));
  const data = await res.json().catch(() => ({ error: `列車の情報を取得できませんでした（${res.status}）` }));
  if (dia !== d) return [];
  if (!res.ok || !data.stops || !data.stops.length) {
    if (options.length) return rankOptions(options);
    throw Object.assign(new Error(data.error || '停車駅が分かりませんでした'), { detail: data });
  }
  const stops = data.stops;
  let here = stops.findIndex((s) => normText(s.name) === normText(d.st.name));
  if (here < 0) here = stops.findIndex((s) => s.dep === t.time);
  const later = stops.slice(here + 1);

  // 乗り換え候補：検索結果に出てきた駅・終点。少なければ途中の駅も足す
  // 検索結果での駅名（「金山(愛知県)」など）も覚えておき、検索にはそちらを使う
  // （列車ページは「金山」のように括弧なしのことがあり、そのまま検索すると別の駅になる）
  const fullName = new Map();
  for (const r of [...(row.searchRoutes || []), ...shownRoutes]) {
    for (const st of r.steps) {
      if (st.kind !== 'station') continue;
      const k = normText(st.name);
      if (!fullName.has(k) || st.name.length > fullName.get(k).length) fullName.set(k, st.name);
    }
  }
  const known = new Set(fullName.keys());
  const nameOf = (S) => fullName.get(normText(S.name)) || S.name;
  const fares = addFareSections(new Map(), [...(row.searchRoutes || []), ...shownRoutes]);
  const destName = normText(d.q.to);
  let cands = later.filter((s, k) => known.has(normText(s.name)) || normText(s.name) === destName || k === later.length - 1);
  for (const s of later) {
    if (cands.length >= 6) break;
    if (!cands.includes(s)) cands.push(s);
  }
  cands = later.filter((s) => cands.includes(s)).slice(0, 8);

  const trainLine = d.tt.railName + (t.kind && t.kind !== '普通' ? t.kind : '');
  await mapLimit(cands, 3, async (S) => {
    let atS = TimeShift.nearDate(S.arr || S.dep, row.dep);
    if (atS && atS < row.dep) atS = new Date(+atS + 24 * 3600e3);
    if (!atS) return;
    const nStops = stops.indexOf(S) - Math.max(here, 0);
    const sName = nameOf(S);
    const legSteps = [
      { kind: 'station', name: d.st.name, arr: '', dep: t.time, isStation: true, code: d.st.code },
      {
        kind: 'access', line: trainLine, destination: `${t.destination}行`, color: (d.train && d.train.color) || '',
        platform: t.track ? `[発] ${t.track}番線` : '', stops: `${nStops}駅`, walk: false, alert: false, alertText: '',
        stopList: stops.slice(Math.max(here, 0) + 1, stops.indexOf(S)).map((x) => ({ name: nameOf(x), time: x.dep || x.arr || '' })),
      },
    ];
    // この電車で S まで乗った場合の運賃。同じ会社の電車だけを使う経路の運賃を使う
    // （距離で決まるので、どの電車でも同じ。特急料金のかかる電車は 1 本で行く経路を優先）
    const company = companyOf(trainLine);
    const legKey = `${normText(d.st.name)}>${normText(sName)}`;
    const legFareP = fares.has(legKey) ? Promise.resolve(fares.get(legKey)) : fetchRoutes({ ...d.q, to: sName, via: '', type: 'dep', when: dateToWhen(row.dep), coords: null })
      .then((r) => {
        const routes = (r && r.routes) || [];
        addFareSections(fares, routes);
        if (fares.has(legKey)) return fares.get(legKey);
        const sameCo = (x) => x.steps.every((st) => st.kind !== 'access' || st.walk || companyOf(st.line) === company);
        const one = routes.find((x) => x.summary.transfers === 0 && sameCo(x) && x.summary.fare != null)
          || routes.find((x) => sameCo(x) && x.summary.fare != null);
        return one ? one.summary.fare : null;
      });

    if (normText(S.name) === destName) {
      const legFare = await legFareP;
      const steps = [...legSteps, { kind: 'station', name: sName, arr: S.arr || S.dep, dep: '', isStation: true, code: S.code || '' }];
      add(makeTail(row, steps, atS), legFare, false, sName);
      return;
    }
    const [contData, legFare] = await Promise.all([
      fetchRoutes({ ...d.q, from: sName, via: '', type: 'dep', when: dateToWhen(atS), coords: null }),
      legFareP,
    ]);
    for (const c of (contData && contData.routes) || []) {
      // 乗った電車にそのまま乗り続ける経路は、もっと先の駅の候補と同じなので除く
      const cLine = normText(firstTrainLine(c));
      if (c.steps[0] && c.steps[0].dep === (S.dep || '') && cLine === normText(trainLine)) continue;
      const steps = [
        ...legSteps,
        { kind: 'station', name: sName, arr: S.arr || S.dep, dep: c.steps[0] ? c.steps[0].dep : '', isStation: true, code: S.code || '' },
        ...c.steps.slice(1),
      ];
      const fare = legFare != null && c.summary.fare != null ? legFare + c.summary.fare : null;
      const sameCompany = companyOf(cLine) === companyOf(trainLine);
      add(makeTail(row, steps, null, c), fare, sameCompany, sName, sameCompany);
    }
  });
  return rankOptions(options);
}

// 組み立てた経路のまとめ（到着・所要時間・乗換回数）
function makeTail(row, steps, arrAt, cont) {
  const last = steps[steps.length - 1];
  const arr = cont ? cont.summary.arr : last.arr;
  let arrDate = TimeShift.nearDate(arr, row.dep);
  if (arrDate && arrDate < row.dep) arrDate = new Date(+arrDate + 24 * 3600e3);
  return {
    summary: {
      dep: row.train.time,
      arr,
      duration: arrDate ? TimeShift.formatMinutes((arrDate - row.dep) / MIN_MS) : '',
      transfers: Math.max(0, steps.filter((s) => s.kind === 'access' && !s.walk).length - 1),
      fare: null,
      fareNote: '',
      distance: '',
      tags: [],
      alert: !!(cont && cont.summary.alert),
    },
    steps,
  };
}

// 検索結果の「運賃の区間」から、駅 A→駅 B の運賃の表を作る（キーは "A>B"）
function addFareSections(table, routes) {
  for (const r of routes || []) {
    const stations = r.steps.filter((x, i) => i % 2 === 0);
    r.steps.forEach((a, i) => {
      if (i % 2 !== 1 || !a.fareGroup || a.farePrice == null) return;
      const m = /^(\d+)_(\d+)$/.exec(a.fareGroup);
      if (!m) return;
      const from = stations[Number(m[1])];
      const to = stations[Number(m[2]) + 1];
      if (from && to) table.set(`${normText(from.name)}>${normText(to.name)}`, a.farePrice);
    });
  }
  return table;
}

function isSameTrain(r, t) {
  const a = r.steps.find((s) => s.kind === 'access');
  if (!a || a.walk) return false;
  const line = normText(a.line);
  const dest = normText(t.destination);
  const kindOk = !t.kind || line.endsWith(normText(t.kind)) || (t.kind === '普通' && !/(急|快|特|準)/.test(line.slice(-4)));
  return kindOk && (!dest || normText(a.destination).startsWith(dest));
}

// 重複を除いて到着順に並べ、早・安・楽の印を付ける
function rankOptions(options) {
  // 一覧で同じに見えるもの（乗り換え駅・到着・路線が同じ）は 1 つにまとめる
  const byLook = new Map();
  for (const o of options) {
    const lines = o.route.steps.filter((x) => x.kind === 'access' && !x.walk).map((x) => normText(x.line)).join('>');
    const k = `${normText(o.via)}|${+o.arr}|${o.transfers}|${lines}`;
    const prev = byLook.get(k);
    const better = !prev || (prev.fare == null && o.fare != null) || (o.fare != null && prev.fare != null && o.fare < prev.fare);
    if (better) byLook.set(k, o);
  }
  const list = [...byLook.values()];
  // 到着・運賃・乗換回数のどれも他より良くないもの（意味のない乗り換えなど）は出さない
  const fareOf = (o) => (o.fare == null ? 1e9 : o.fare);
  // （違う会社の路線に乗り換える経路は、少し高くても選べるように残す）
  const kept = list.filter((o) => !o.sameCompany || !list.some((p) => p !== o
    && +p.arr <= +o.arr && p.transfers <= o.transfers && fareOf(p) <= fareOf(o)
    && (+p.arr < +o.arr || p.transfers < o.transfers || fareOf(p) < fareOf(o))));
  list.length = 0;
  list.push(...kept);
  list.sort((a, b) => a.arr - b.arr || (a.fare ?? 1e9) - (b.fare ?? 1e9) || a.transfers - b.transfers);
  const minArr = Math.min(...list.map((o) => +o.arr));
  const fares = list.map((o) => o.fare).filter((f) => f != null);
  const minFare = fares.length ? Math.min(...fares) : null;
  const minTr = Math.min(...list.map((o) => o.transfers));
  for (const o of list) {
    const tags = [];
    if (+o.arr === minArr) tags.push('早');
    if (minFare != null && o.fare === minFare) tags.push('安');
    if (o.transfers === minTr) tags.push('楽');
    o.route.summary.tags = tags;
  }
  return list.slice(0, 10);
}

// 選んだ電車を使う経路の候補一覧
function renderTrainOptions(d, list) {
  const { row, options } = d.view;
  const t = row.train;
  const back = el('button', 'dia-more dia-back', '‹ 前後のダイヤに戻る');
  back.type = 'button';
  back.addEventListener('click', () => { d.view = null; d.scrolled = false; renderDia(); });
  list.append(back);
  list.append(el('p', 'dia-options-title', `${t.time}発 ${d.tt.railName}${t.kind && t.kind !== '普通' ? t.kind : ''}・${t.destination}行 を使う経路`));

  const hm = (dt) => `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  for (const o of options) {
    const s = o.route.summary;
    const btn = el('button', 'dia-row');
    btn.type = 'button';
    const tags = el('div', 'tags');
    s.tags.forEach((tg) => tags.append(el('span', `tag tag-${{ 早: 'fast', 安: 'cheap', 楽: 'easy' }[tg]}`, tg)));
    if (s.tags.length) btn.append(tags);

    const times = el('div', 'dia-times');
    times.append(el('b', '', t.time), el('span', 'dia-arrow', '→'), el('b', '', hm(o.arr)));
    times.append(el('small', '', `(${s.duration}) 乗換${s.transfers}回`));
    btn.append(times);

    const fareText = o.fare != null ? `${o.fareApprox ? '約' : ''}${o.fare.toLocaleString('ja-JP')}円` : '運賃不明';
    btn.append(el('div', 'dia-line', fareText + (o.via ? `・${o.via}で乗り換え` : '')));
    const lines = o.route.steps.filter((x) => x.kind === 'access' && !x.walk).map((x) => x.line);
    btn.append(el('div', 'dia-sub', lines.join(' → ')));
    if (d.stepIndex > 0) btn.append(el('div', 'dia-total', diaTotalText(d, row.dep, o.arr)));
    btn.addEventListener('click', () => {
      row.route = o.route;
      chooseDia({ route: o.route });
    });
    list.append(btn);
  }
  if (options.some((o) => o.fareApprox)) {
    list.append(el('p', 'dia-note-row dia-options-note', '「約」の運賃は、乗り換え前後の運賃を足した目安です。'));
  }
}

// 調査用データをコピーするボタン（コピーできない環境では文字を選択できるように表示）
function reportButton(text) {
  const wrap = el('div', 'dia-report');
  const b = el('button', 'chip', '原因を調べるデータをコピー（チャットに貼って送ってください）');
  b.type = 'button';
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = 'コピーしました。チャットに貼り付けて送ってください';
    } catch (e) {
      const ta = el('textarea', 'dia-report-text');
      ta.value = text;
      ta.readOnly = true;
      wrap.append(ta);
      ta.select();
      b.remove();
    }
  });
  wrap.append(b);
  return wrap;
}

function renderTimetableDia(d, list) {
  const pad2 = (dt) => `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  const earlier = el('button', 'dia-more', '▲ さらに前を表示');
  earlier.type = 'button';
  earlier.addEventListener('click', () => { d.from -= 60; fillTimetableRows(d); });
  list.append(earlier);

  const rows = [...d.rows.values()].sort((a, b) => a.dep - b.dep);
  let currentRow = null;
  for (const r of rows) {
    const t = r.train;
    const btn = el('button', 'dia-row');
    btn.type = 'button';
    const isCurrent = !currentRow && t.time === d.st.dep && d.tt.matchedIndex >= 0 && d.tt.trains[d.tt.matchedIndex].trainId === t.trainId;
    if (isCurrent) { btn.classList.add('current'); currentRow = btn; }
    if (r.state === 'tooEarly') btn.disabled = true;

    const times = el('div', 'dia-times');
    times.append(el('b', '', t.time), el('span', 'dia-arrow', '→'));
    if (r.state === 'done' && r.arr) {
      times.append(el('b', r.exact ? '' : 'estimate', pad2(r.arr)));
      const meta = [`(${TimeShift.formatMinutes((r.arr - r.dep) / MIN_MS)})`];
      if (r.exact && r.route.summary.transfers != null) meta.push(`乗換${r.route.summary.transfers}回`);
      times.append(el('small', '', meta.join(' ')));
    } else if (r.state === 'tooEarly') {
      times.append(el('small', '', '－'));
    } else if (r.state === 'done') {
      times.append(el('small', '', '経路なし'));
    } else {
      times.append(el('small', '', '検索中…'));
    }
    btn.append(times);

    btn.append(el('div', 'dia-line', `${d.tt.railName}${t.kind && t.kind !== '普通' ? t.kind : ''}・${t.destination}行`));
    const sub = [t.cars && `${t.cars}両`, t.track && `${t.track}番線発`].filter(Boolean).join('　');
    if (sub) btn.append(el('div', 'dia-sub', sub));

    if (r.state === 'tooEarly') {
      btn.append(el('div', 'dia-note-row', `乗り継げません（${d.st.name} ${d.st.arr}着）`));
    } else if (r.state === 'done' && r.arr && !r.exact) {
      btn.append(el('div', 'dia-note-row', '到着は目安（タップでこの電車を使う経路を探します）'));
    } else if (r.state === 'done' && r.arr && d.stepIndex > 0) {
      btn.append(el('div', 'dia-total',
        diaTotalText(d, r.dep, r.arr)));
    }
    if (isCurrent) btn.append(el('div', 'dia-current', '表示中の電車'));
    if (r.building) btn.append(el('div', 'dia-current', 'この電車を使う経路を探しています…'));
    if (r.error && !r.building) btn.append(el('div', 'dia-error', `経路を作れませんでした：${r.error.message}`));
    btn.addEventListener('click', () => {
      if (r.state !== 'done') return;
      buildTrainRoute(d, r);
    });
    list.append(btn);
    if (r.error && !r.building) list.append(reportButton(r.error.report));
  }

  if (!rows.length) list.append(el('p', 'empty', 'この時間帯の電車はありません'));

  const later = el('button', 'dia-more', '▼ さらに後を表示');
  later.type = 'button';
  later.addEventListener('click', () => { d.to += 60; fillTimetableRows(d); });
  list.append(later);

  if (currentRow && !d.scrolled) {
    d.scrolled = true;
    currentRow.scrollIntoView({ block: 'center' });
  }
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
  if (d.mode === 'timetable') {
    if (d.loading || !d.rows) list.append(el('p', 'loading', '時刻表を読み込み中…'));
    else if (d.view) renderTrainOptions(d, list);
    else renderTimetableDia(d, list);
    return;
  }
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
        diaTotalText(d, e.dep, e.arr)));
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
  if (r.via) frag.append(el('small', '', `${splitVia(r.via).join('・')} 経由`));
  return frag;
}

function fillRoute(r) {
  fromEl.value = r.from || '';
  toEl.value = r.to || '';
  fromCoords = null;
  setVias(splitVia(r.via));
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
    [r.from, r.to, ...splitVia(r.via)].forEach((n) => { if (n && n !== CURRENT_LOCATION) names.add(n); });
  });
  // 検索結果に出てきた駅名（「金山(愛知県)」など、そのまま検索に使える正式な名前）
  store.get('seenStations', []).forEach((n) => names.add(n));
  knownNames = [...names];
}

// ---------- 入力候補（駅・バス停） ----------
// 入力中に、履歴・お気に入り・検索結果に出てきた名前と、Yahoo の「駅・バス停」候補を出す。
// バス停は Yahoo で「則武本郷/岐阜バス」と書くと確実に使えるので、選ぶとその形で入る。
let knownNames = [];
const suggCache = new Map();
let suggTimer = 0;
let suggInput = null;
const suggBox = el('div', 'sugg');
suggBox.hidden = true;
suggBox.setAttribute('role', 'listbox');

const normName = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()
  .replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

function candOf(v) {
  const m = /^(.+?)\/(.+)$/.exec(v);
  return m ? { name: m[1], value: v, kind: 'bus', company: m[2] } : { name: v, value: v, kind: 'station', company: '' };
}

function suggestionsFor(text) {
  const q = normName(text);
  if (!q) return [];
  const mine = knownNames.filter((n) => n !== CURRENT_LOCATION && normName(n).includes(q))
    .map((n) => ({ ...candOf(n), mine: true }))
    .sort((a, b) => (normName(a.name).startsWith(q) ? 0 : 1) - (normName(b.name).startsWith(q) ? 0 : 1))
    .slice(0, 4);
  const remote = suggCache.get(q) || [];
  const seen = new Set();
  return [...mine, ...remote].filter((c) => (seen.has(c.value) ? false : seen.add(c.value))).slice(0, 8);
}

async function fetchSuggest(text) {
  const q = normName(text);
  if (!q || suggCache.has(q)) return;
  try {
    const res = await fetch('api/suggest?' + query({ q: text.trim() }));
    const data = await res.json();
    suggCache.set(q, Array.isArray(data.items) ? data.items : []);
  } catch (e) {
    return; // 通信できなくても、履歴からの候補だけ出す
  }
  if (suggInput && normName(suggInput.value) === q) renderSugg(suggInput);
}

function hideSugg() {
  suggBox.hidden = true;
  suggInput = null;
}

function renderSugg(input) {
  const text = input.value.trim();
  const items = text && text !== CURRENT_LOCATION ? suggestionsFor(text) : [];
  // 入力とまったく同じものしかないなら出さない
  if (!items.length || (items.length === 1 && items[0].value === text)) { suggBox.hidden = true; return; }
  suggBox.textContent = '';
  for (const c of items) {
    const b = el('button', 'sugg-item');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.append(el('span', 'sugg-ic ' + c.kind, c.kind === 'bus' ? '🚌' : '🚉'));
    const t = el('span', 'sugg-t');
    t.append(el('b', '', c.name));
    t.append(el('small', '', c.kind === 'bus' ? `バス停${c.company ? '・' + c.company : ''}` : '駅'));
    b.append(t);
    if (c.mine) b.append(el('span', 'sugg-tag', '履歴'));
    // タップでキーボードが閉じる前に選べるように
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => pickSugg(input, c));
    suggBox.append(b);
  }
  const row = input.closest('.station-row');
  const wrap = $('searchForm').querySelector('.stations');
  if (suggBox.parentNode !== wrap) wrap.append(suggBox);
  suggBox.style.top = `${row.offsetTop + row.offsetHeight + 4}px`;
  suggBox.hidden = false;
}

function pickSugg(input, c) {
  input.value = c.value;
  if (input === fromEl) { fromCoords = null; $('nearbyRow').hidden = true; }
  hideSugg();
  if (input === fromEl) toEl.focus();
  else input.blur();
}

function onStationInput(e) {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || !input.closest('.station-row')) return;
  suggInput = input;
  renderSugg(input);
  clearTimeout(suggTimer);
  const text = input.value.trim();
  if (text && text !== CURRENT_LOCATION && !text.includes('/')) suggTimer = setTimeout(() => fetchSuggest(text), 220);
}

// 「則武本郷」だけ入れたとき：同じ名前の駅がなく、バス停がひとつに決まるなら「則武本郷/岐阜バス」で検索する
function resolveBusStops() {
  const changed = [];
  for (const input of [fromEl, toEl, ...viaInputs()]) {
    const v = input.value.trim();
    if (!v || v === CURRENT_LOCATION || v.includes('/')) continue;
    const key = normName(v);
    const cands = [...knownNames.map(candOf), ...(suggCache.get(key) || [])].filter((c) => normName(c.name) === key);
    if (cands.some((c) => c.kind === 'station')) continue;
    const buses = [...new Set(cands.filter((c) => c.kind === 'bus').map((c) => c.value))];
    if (buses.length !== 1) continue;
    input.value = buses[0];
    if (input === fromEl) fromCoords = null;
    changed.push(buses[0]);
  }
  if (changed.length) toast(`バス停「${changed.join('」「')}」で検索します`);
}

// 結果画面：Yahoo が「ほかの候補」を出したときに、ワンタップで出発・到着を差し替える
function altCard(q, alt) {
  if (!alt) return null;
  const pick = (list, cur) => (list || []).filter((c) => c && c.value && c.value !== cur).slice(0, 4);
  const from = pick(alt.from, q.from);
  const to = pick(alt.to, q.to);
  if (!from.length && !to.length) return null;
  const box = el('div', 'card alt-card');
  box.append(el('p', 'alt-head', 'もしかして'));
  const row = (label, list, key) => {
    if (!list.length) return;
    const r = el('div', 'alt-row');
    r.append(el('span', 'alt-label', label));
    for (const c of list) {
      const b = el('button', 'chip', `${c.kind === 'bus' ? '🚌 ' : ''}${c.name}${c.company ? `（${c.company}）` : ''}`);
      b.type = 'button';
      b.addEventListener('click', () => {
        const nq = { ...q, [key]: c.value };
        if (key === 'from') { nq.coords = null; fromEl.value = c.value; } else toEl.value = c.value;
        addHistory(nq);
        showResults(nq, true);
      });
      r.append(b);
    }
    box.append(r);
  };
  row('出発', from, 'from');
  row('到着', to, 'to');
  return box;
}

// ---------- 現在地 ----------
// 現在地の住所と最寄り駅を Worker に問い合わせる
async function lookupHere(lat, lng) {
  const res = await fetch('api/nearest?' + query({ lat, lng }));
  const data = await res.json().catch(() => ({}));
  if (!data.address && !(data.stations && data.stations.length)) throw new Error(data.error || 'not found');
  return { address: data.address || '', stations: data.stations || [] };
}

function getPosition(options) {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
}

// 出発欄の下に「現在地の住所」と近くの駅を並べ、タップで切り替えられるようにする
function renderNearby(here, coords) {
  const row = $('nearbyRow');
  row.textContent = '';
  const choices = [];
  if (here.address) choices.push({ label: '📍 現在地の住所', value: here.address, coords });
  here.stations.forEach((st) => choices.push({ label: st.name, value: st.name, title: `${st.lines.join('・')} ${st.distance}` }));
  row.hidden = choices.length < 2;
  if (row.hidden) return;
  row.append(el('span', 'nearby-label', '出発地'));
  choices.forEach((c) => {
    const b = el('button', 'chip', c.label);
    b.type = 'button';
    if (c.title) b.title = c.title;
    b.addEventListener('click', () => {
      fromEl.value = c.value;
      fromCoords = c.coords || null;
      row.querySelectorAll('.chip').forEach((x) => x.classList.toggle('selected', x === b));
    });
    if (fromEl.value === c.value) b.classList.add('selected');
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
    pos = await getPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 })
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
  const coords = { lat: lat.toFixed(6), lng: lng.toFixed(6) };
  try {
    const here = await lookupHere(lat, lng);
    if (here.address) {
      // 住所から出発（Yahoo が最寄り駅までの徒歩も含めて案内する）
      fromEl.value = here.address;
      fromCoords = { ...coords, label: here.address };
      toast(`現在地：${here.address}`);
    } else {
      fromEl.value = here.stations[0].name;
      fromCoords = null;
      toast(`住所は取得できなかったので最寄り駅にしました：${here.stations[0].name}`);
    }
    renderNearby(here, fromCoords && fromCoords.label ? fromCoords : null);
  } catch (e) {
    fromEl.value = CURRENT_LOCATION;
    fromCoords = coords;
    $('nearbyRow').hidden = true;
    toast('住所・最寄り駅を取得できませんでした（地図アプリでは現在地から検索できます）');
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

// ---------- 引っ張って更新（検索結果） ----------
function setupPullToRefresh() {
  const ind = el('div', 'ptr'); ind.id = 'ptr'; ind.setAttribute('aria-hidden', 'true');
  ind.innerHTML = '<span class="ptr-c"><svg viewBox="0 0 24 24" class="ptr-arrow"><path d="M12 5v13M6.5 12.5 12 18l5.5-5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><i class="ptr-spin"></i></span>';
  document.body.append(ind);
  const view = $('resultView'), arrow = ind.querySelector('.ptr-arrow');
  const TH = 64, HOLD = 56, MAX = 130;
  let y0 = null, pull = 0, busy = false, raf = 0, ready = false;
  // the further you pull, the harder it gets (like iPhone's rubber band)
  const damp = (dy) => MAX * (1 - Math.exp(-dy / (MAX * 1.4)));
  const paint = (d, anim) => {
    const tr = anim ? 'transform .42s cubic-bezier(.2,.9,.25,1), opacity .3s' : 'none';
    view.style.transition = tr; ind.style.transition = tr;
    view.style.transform = d ? `translate3d(0, ${d.toFixed(1)}px, 0)` : '';
    ind.style.transform = `translate3d(-50%, ${(Math.min(d, MAX) - 46).toFixed(1)}px, 0)`;
    ind.style.opacity = d > 6 ? Math.min(1, (d - 6) / 34).toFixed(2) : 0;
    const r = d >= TH; if (r !== ready) { ready = r; ind.classList.toggle('ready', r); if (r && navigator.vibrate) navigator.vibrate(8); }
    arrow.style.transform = `rotate(${r ? 180 : 0}deg)`;
  };
  document.addEventListener('touchstart', (e) => {
    if (busy || view.hidden || e.touches.length > 1 || window.scrollY > 0 || e.target.closest('dialog')) { y0 = null; return; }
    y0 = e.touches[0].clientY; pull = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy <= 0 || window.scrollY > 0) { if (pull) { pull = 0; paint(0, true); } return; }
    if (e.cancelable) e.preventDefault(); // our own rubber band instead of the page bouncing as well
    pull = damp(dy);
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (y0 !== null) paint(pull, false); });
  }, { passive: false });
  const end = async () => {
    if (y0 === null) return; y0 = null; cancelAnimationFrame(raf); raf = 0;
    if (pull < TH || !shownQuery) { pull = 0; paint(0, true); return; }
    busy = true; ind.classList.add('spin'); paint(HOLD, true);
    const t0 = Date.now();
    try { await showResults(shownQuery, false, { soft: true }); } catch (e) {}
    await new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - t0)))); // keep the spinner long enough to be seen
    ind.classList.remove('spin'); pull = 0; paint(0, true);
    setTimeout(() => { busy = false; view.style.transition = ''; }, 450);
  };
  document.addEventListener('touchend', end); document.addEventListener('touchcancel', end);
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
      via: p.getAll('via').flatMap(splitVia).slice(0, MAX_VIA).join(VIA_SEP),
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
  $('searchForm').addEventListener('input', onStationInput);
  $('searchForm').addEventListener('focusin', (e) => { if (e.target.closest && e.target.closest('.station-row') && e.target.tagName === 'INPUT') onStationInput(e); });
  $('searchForm').addEventListener('focusout', () => setTimeout(() => {
    const a = document.activeElement;
    if (!a || !a.closest || !a.closest('.station-row')) hideSugg();
  }, 120));
  fromEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); toEl.focus(); }
  });
  fromEl.addEventListener('input', () => { fromCoords = null; $('nearbyRow').hidden = true; });
  $('swapBtn').addEventListener('click', () => {
    const a = fromEl.value;
    fromEl.value = toEl.value;
    toEl.value = a === CURRENT_LOCATION ? '' : a;
    fromCoords = null;
    setVias(viaInputs().map((i) => i.value).reverse()); // 経由の順番も逆に
  });
  $('nowBtn').addEventListener('click', () => { setNow(); setType('dep'); });
  $('locBtn').addEventListener('click', useCurrentLocation);
  $('viaBtn').addEventListener('click', () => {
    const vias = viaInputs().map((i) => i.value);
    if (vias.length >= MAX_VIA) return;
    setVias([...vias, '']);
    const inputs = viaInputs();
    inputs[inputs.length - 1].focus();
  });

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
  let settingsBefore = '';
  $('settingsBtn').addEventListener('click', () => { loadSettingsForm(); settingsBefore = JSON.stringify(settings); dlg.showModal(); });
  // 結果を見ているときに設定（新幹線を使わない など）を変えたら、閉じたときに同じ条件で検索し直す
  dlg.addEventListener('close', () => {
    if (settingsBefore && JSON.stringify(settings) !== settingsBefore && shownQuery && !$('resultView').hidden) {
      showResults(shownQuery, false); toast('設定を反映して、検索し直しました');
    }
    settingsBefore = '';
  });
  setupPullToRefresh();
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
  if (HIBI && HIBI.date && !new URLSearchParams(location.search).get('to')) {
    whenEl.value = `${HIBI.date}T${HIBI.time || '09:00'}`;
    timeIsCustom = true;
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
