import { parse } from 'node-html-parser';

export const YAHOO_ORIGIN = 'https://transit.yahoo.co.jp';

// 検索モード → Yahoo の type パラメータ
const TYPE_CODE = { dep: '1', arr: '4', first: '3', last: '2' };

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * アプリからのクエリを検証して Yahoo!乗換案内の検索 URL を作る。
 * 受け付けるパラメータを限定しているので、任意の URL を取りに行く踏み台にはならない。
 */
export function buildSearchUrl(params, origin = YAHOO_ORIGIN) {
  const get = (k) => (params.get(k) || '').trim();
  const from = get('from');
  const to = get('to');
  if (!from || !to) throw new InputError('出発駅と到着駅を入力してください');
  if (from.length > 60 || to.length > 60) throw new InputError('駅名が長すぎます');

  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(get('date'));
  const time = /^(\d{1,2}):(\d{2})$/.exec(get('time'));
  if (!date || !time) throw new InputError('日時の形式が正しくありません');

  const flag = (k) => (get(k) === '0' ? '0' : '1');
  const pick = (k, allowed, def) => (allowed.includes(get(k)) ? get(k) : def);

  const q = new URLSearchParams();
  q.set('from', from);
  q.set('to', to);
  for (const v of params.getAll('via').map((s) => s.trim()).filter(Boolean).slice(0, 3)) {
    q.append('via', v.slice(0, 60));
  }
  q.set('y', date[1]);
  q.set('m', date[2]);
  q.set('d', date[3]);
  q.set('hh', pad2(time[1]));
  q.set('m1', time[2][0]);
  q.set('m2', time[2][1]);
  q.set('type', TYPE_CODE[get('type')] || TYPE_CODE.dep);
  q.set('ticket', pick('ticket', ['ic', 'normal'], 'ic'));
  q.set('expkind', pick('expkind', ['1', '2', '3'], '1'));
  q.set('userpass', '1');
  q.set('ws', pick('ws', ['1', '2', '3', '4'], '3'));
  q.set('s', pick('s', ['0', '1', '2'], '0'));
  for (const k of ['al', 'shin', 'ex', 'hb', 'lb', 'sr']) q.set(k, flag(k));

  return `${origin}/search/result?${q}`;
}

export class InputError extends Error {}

// ---------- HTML 解析 ----------

// 全角英数を半角に、連続する空白を 1 つに
const clean = (s) => (s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const text = (el) => (el ? clean(el.textContent) : '');
const hasClass = (el, name) => !!el.classList && el.classList.contains(name);
const elementChildren = (el) => el.childNodes.filter((n) => n.nodeType === 1);
const TIME_RE = /(\d{1,2}:\d{2})/;

function parseSummary(routeEl) {
  const sum = routeEl.querySelector('.routeSummary');
  if (!sum) return null;
  const timeText = text(sum.querySelector('li.time'));
  const dep = /(\d{1,2}:\d{2})発/.exec(timeText);
  const arr = /(\d{1,2}:\d{2})着/.exec(timeText);
  const duration = clean(timeText.split('着').slice(1).join('着'));
  const transfer = /(\d+)回/.exec(text(sum.querySelector('li.transfer')));
  const fareText = text(sum.querySelector('li.fare'));
  const fare = /([\d,]+)円/.exec(fareText);
  return {
    dep: dep ? dep[1] : '',
    arr: arr ? arr[1] : '',
    duration,
    transfers: transfer ? Number(transfer[1]) : null,
    fare: fare ? Number(fare[1].replace(/,/g, '')) : null,
    fareNote: clean(fareText.replace(/[\d,]+円/, '')),
    distance: text(sum.querySelector('li.distance')),
    tags: sum.querySelectorAll('ul.priority li span').map(text).filter(Boolean),
    alert: !!sum.querySelector('li.time .icnAlert'),
  };
}

function parseStation(el) {
  const link = el.querySelector('dl dt a');
  const name = text(link) || text(el.querySelector('dl dt'));
  // 駅ページへのリンクがあれば駅（住所や施設から検索したときの出発地点にはない）
  const isStation = !!(link && /\/station\//.test(link.getAttribute('href') || ''));
  let arr = '';
  let dep = '';
  for (const li of el.querySelectorAll('ul.time li')) {
    const t = text(li);
    const m = TIME_RE.exec(t);
    if (!m) continue;
    if (t.includes('着')) arr = m[1];
    else if (t.includes('発')) dep = m[1];
    else if (!dep) dep = m[1];
  }
  return { kind: 'station', name, arr, dep, isStation };
}

// Yahoo のページにあるリンクの文字（アプリでは使えない）
const JUNK_RE = /地図でルート表示|ルートを表示|地図を表示|地図を見る/g;

function parseWalk(el) {
  const all = text(el).replace(JUNK_RE, ' ');
  const min = /徒歩\s*(\d+)\s*分/.exec(all);
  const exit = /出口\s*[:：]?\s*(?!徒歩)([^\s:：]+?)(?=\s|徒歩|$)/.exec(all);
  return {
    walkMinutes: min ? Number(min[1]) : null,
    exit: exit ? exit[1] : '',
  };
}

function parseAccess(el) {
  const transport = el.querySelector('li.transport');
  const destination = text(transport && transport.querySelector('.destination'));
  let line = text(transport).replace(JUNK_RE, ' ');
  if (destination) line = line.replace(destination, '');
  line = clean(line);
  const walk = /徒歩/.test(line) && !destination;
  const status = el.querySelector('li.serviceStatus');
  if (walk) {
    const w = parseWalk(el);
    return {
      kind: 'access',
      line: w.walkMinutes != null ? `徒歩${w.walkMinutes}分` : '徒歩',
      destination: '',
      color: '',
      platform: w.exit ? `出口：${w.exit}` : '',
      stops: '',
      walk: true,
      walkMinutes: w.walkMinutes,
      exit: w.exit,
      alert: !!(status && status.querySelector('.icnAlert')),
      alertText: text(status),
    };
  }
  const lineEl = transport && transport.querySelector('.line');
  const style = (lineEl && lineEl.getAttribute('style')) || '';
  const color = /border-color:\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]*\))/.exec(style);
  return {
    kind: 'access',
    line,
    destination,
    color: color ? color[1] : '',
    platform: clean(text(el.querySelector('li.platform')).replace(JUNK_RE, ' ')),
    stops: text(el.querySelector('li.stop')),
    walk: false,
    alert: !!(status && status.querySelector('.icnAlert')),
    alertText: text(status),
  };
}

// routeDetail の直下は station / access / fareSection（入れ子あり）が並ぶ
function flattenDetail(el, out) {
  for (const child of elementChildren(el)) {
    if (hasClass(child, 'station')) out.push(parseStation(child));
    else if (hasClass(child, 'access')) out.push(parseAccess(child));
    else if (hasClass(child, 'fareSection')) flattenDetail(child, out);
  }
  return out;
}

export function parseResult(html) {
  const root = parse(html);
  const routes = [];
  for (let i = 1; i <= 9; i++) {
    const routeEl = root.querySelector(`#route${pad2(i)}`);
    if (!routeEl) break;
    const summary = parseSummary(routeEl);
    const detailEl = routeEl.querySelector('.routeDetail');
    const steps = detailEl ? flattenDetail(detailEl, []) : [];
    if (summary && (summary.dep || steps.length)) routes.push({ summary, steps });
  }
  return { routes };
}
