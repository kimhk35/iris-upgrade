// 설치 서버의 Gemini 흐름(P18 2026-11-21) — 가짜 geminiRunner·onlineRunner 만. 실제 agy·인터넷·C:\ 접촉 0.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startServer } from '../installer/server.mjs';
import { SETUP_STAGE_IDS } from '../installer/lib/receipt.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-server-gemini-'));
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
const zipRoot = path.join(tmp, 'zip-root');
fs.mkdirSync(path.join(zipRoot, 'payload'), { recursive: true });
fs.writeFileSync(path.join(zipRoot, 'payload', 'manifest.json'), JSON.stringify({ schema: 1, package: { name: 'IRIS', version: '2.0.0' }, parts: {} }));
fs.writeFileSync(path.join(zipRoot, 'lock.json'), JSON.stringify({ schema: 1, package: { version: '2.0.0' }, parts: {} }));

const JSON_HDR = { 'Content-Type': 'application/json' };
const post = async (url, p, body) => (await fetch(`${url}${p}`, { method: 'POST', headers: JSON_HDR, body: JSON.stringify(body ?? {}) })).json();
const getJson = async (url, p) => (await fetch(`${url}${p}`)).json();

const okOnline = () => ({
  checkNet: async () => ({ ok: true, blocked: [] }),
  installClaude: async () => ({ ok: true, source: 'claude.ai' }),
  installDocumentSkills: async () => ({ ok: true, state: 'done' }),
  startLogin: async () => ({ ok: true, state: 'waiting', cli: 'pending', relay: 'pending' }),
  loginStatus: async () => ({ state: 'done', cli: 'done', relay: 'done', reason: null }),
  startRelay: async () => ({ ok: true, state: 'done', accounts: 1 }),
});

// 가짜 Gemini: 설치 결과·로그인 상태를 시험이 정한다
function fakeGemini({ install = { ok: true, source: 'download', version: '1.5.13' }, already = false } = {}) {
  const calls = { install: 0, start: 0, skip: 0, status: 0 };
  let loginState = { state: 'idle', reason: null, startedAt: null };
  const login = {
    probe: async () => { if (already) loginState = { state: 'done', reason: 'already', startedAt: null }; return loginState; },
    start: async () => { calls.start++; loginState = { state: 'waiting', reason: null, startedAt: 1 }; return loginState; },
    status: () => { calls.status++; return loginState; },
    skip: async () => { calls.skip++; loginState = { state: 'skipped', reason: null, startedAt: null }; return loginState; },
    closeWindow: async () => {},
  };
  return {
    calls, finish: () => { loginState = { state: 'done', reason: null, startedAt: null }; },
    runner: { install: async (o) => { calls.install++; o.onProgress?.({ done: 10, total: 100 }); return install; }, createLogin: () => login },
  };
}

let seq = 0;
async function start(gem) {
  const id = `g${++seq}`;
  return startServer({
    port: 0, zipRoot, nodeDir: path.dirname(process.execPath),
    stateFile: path.join(tmp, `state-${id}.json`), soulRoot: path.join(tmp, 'souls', id), workDir: path.join(tmp, 'logs', id),
    precheckFn: async () => ({ blockers: [], warnings: [], info: {}, recorded: { os: { ok: true } } }),
    setupRunner: { async runSetup(ctx, { onStage }) { for (const s of SETUP_STAGE_IDS) onStage({ id: s, status: 'done' }); return { ok: true, pending: [] }; } },
    onlineRunner: okOnline(), geminiRunner: gem.runner,
    relayRecheckFn: async () => ({ items: [] }), reportFetchFn: async () => ({ status: 200 }),
  });
}
async function until(url, pred, what) {
  for (let i = 0; i < 300; i++) { const b = await getJson(url, '/api/online/status'); if (pred(b)) return b; await new Promise((r) => setTimeout(r, 20)); }
  assert.fail(`never: ${what}`);
}

test('Gemini 만 고르면 거절(Claude·ChatGPT 중 하나 필요) · 고르지 않으면 선택 기록 모양 그대로', async () => {
  const gem = fakeGemini(); const h = await start(gem);
  try {
    await post(h.url, '/api/precheck'); await post(h.url, '/api/locate');
    const only = await post(h.url, '/api/choice', { subscriptions: ['gemini'] });
    assert.equal(only.ok, false); assert.match(only.message, /Gemini 만으로는/);
    await post(h.url, '/api/choice', { subscriptions: ['claude'] });
    await post(h.url, '/api/online/start');
    const b = await until(h.url, (x) => x.claude?.state === 'done' && !x.running, 'online ran');
    assert.equal(b.geminiChosen, false);
    assert.equal(gem.calls.install, 0, '고르지 않으면 받지 않는다');
    assert.equal(b.gemini, undefined);
  } finally { await h.close(); }
});

test('고르면: 받기 → 로그인 → 상태 확인 → 끝 · 건너뛰기', async () => {
  const gem = fakeGemini(); const h = await start(gem);
  try {
    await post(h.url, '/api/precheck'); await post(h.url, '/api/locate');
    const c = await post(h.url, '/api/choice', { subscriptions: ['claude', 'gemini'] });
    assert.equal(c.ok, true);
    await post(h.url, '/api/online/start');
    let b = await until(h.url, (x) => x.gemini?.install?.state === 'done', 'gemini installed');
    assert.equal(b.geminiChosen, true); assert.equal(b.gemini.login.state, 'idle');
    assert.equal(gem.calls.install, 1);
    const lg = await post(h.url, '/api/online/gemini/login');
    assert.equal(lg.ok, true); assert.equal(lg.state, 'waiting');
    await getJson(h.url, '/api/online/status');
    assert.ok(gem.calls.status >= 1, '폴링이 로그인 상태를 묻는다');
    gem.finish();
    b = await until(h.url, (x) => x.gemini?.login?.state === 'done', 'gemini login done');
    const sk = await post(h.url, '/api/online/gemini/skip');
    assert.equal(sk.state, 'done', '끝난 로그인은 건너뛰기로 덮지 않는다');
  } finally { await h.close(); }
});

test('원래 로그인된 PC 는 창 없이 끝 · 받기 실패는 기록되고 다시 받기로 이어진다', async () => {
  const a = fakeGemini({ already: true }); const ha = await start(a);
  try {
    await post(ha.url, '/api/precheck'); await post(ha.url, '/api/locate');
    await post(ha.url, '/api/choice', { subscriptions: ['chatgpt', 'gemini'] });
    await post(ha.url, '/api/online/start');
    const b = await until(ha.url, (x) => x.gemini?.login?.state === 'done', 'already');
    assert.equal(b.gemini.login.reason, 'already'); assert.equal(a.calls.start, 0);
  } finally { await ha.close(); }

  const f = fakeGemini({ install: { ok: false, reason: 'checksum', message: '지문이 다릅니다' } }); const hf = await start(f);
  try {
    await post(hf.url, '/api/precheck'); await post(hf.url, '/api/locate');
    await post(hf.url, '/api/choice', { subscriptions: ['claude', 'gemini'] });
    await post(hf.url, '/api/online/start');
    const b = await until(hf.url, (x) => x.gemini?.install?.state === 'failed', 'failed');
    assert.equal(b.gemini.install.reason, 'checksum');
    const lg = await post(hf.url, '/api/online/gemini/login');
    assert.equal(lg.ok, false); assert.equal(lg.reason, 'not-installed');
    f.runner.install = async () => ({ ok: true, source: 'download', version: '1.5.13' });
    await post(hf.url, '/api/online/gemini/install');
    await until(hf.url, (x) => x.gemini?.install?.state === 'done', 'reinstalled');
  } finally { await hf.close(); }
});

test('⑦ 에서 Gemini 를 더하면 그때 받는다 · 빼도 Claude 흐름은 그대로', async () => {
  const gem = fakeGemini(); const h = await start(gem);
  try {
    await post(h.url, '/api/precheck'); await post(h.url, '/api/locate');
    await post(h.url, '/api/choice', { subscriptions: ['claude'] });
    await post(h.url, '/api/online/start');
    await until(h.url, (x) => x.claude?.state === 'done' && !x.running, 'online ran');
    const r = await post(h.url, '/api/online/choice', { subscriptions: ['claude'], gemini: true });
    assert.equal(r.ok, true);
    await until(h.url, (x) => x.gemini?.install?.state === 'done', 'added gemini installed');
    const r2 = await post(h.url, '/api/online/choice', { subscriptions: ['claude'] });
    assert.equal(r2.ok, true);
    const b = await getJson(h.url, '/api/online/status');
    assert.equal(b.geminiChosen, true, 'gemini 칸 없이 오면(옛 화면) 지금 값 유지');
  } finally { await h.close(); }
});
