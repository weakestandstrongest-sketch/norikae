import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';

const html = readFileSync(new URL('./fixtures/result.html', import.meta.url), 'utf8');

// Yahoo への問い合わせとキャッシュをテスト用に差し替える
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async () => new Response(html, { status: 200 });

const search = (origin) => worker.fetch(
  new Request('https://norikae.example.workers.dev/api/search?from=新宿&to=渋谷&date=2026-10-12&time=09:00&type=arr', { headers: origin ? { origin } : {} }),
  {},
  { waitUntil() {} },
);

test('ひび手帳（github.io）からの検索には CORS ヘッダーを付ける', async () => {
  const res = await search('https://someone.github.io');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://someone.github.io');
  const body = await res.json();
  assert.ok(Array.isArray(body.routes));
});

test('ほかのサイトからの検索には CORS ヘッダーを付けない', async () => {
  const res = await search('https://evil.example.com');
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('同じサイトからの検索（Origin なし）はそのまま', async () => {
  const res = await search(null);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.status, 200);
});
