// lib/gemini.mjs — Gemini(agy) 받기·두기 (P18 2026-11-21). 네트워크·실제 LOCALAPPDATA·실제 agy 접촉 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { installGemini, findAgy, agyTarget, agyModelsFrom } from '../installer/lib/gemini.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCK = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'lock.json'), 'utf8'));
const BODY = Buffer.from('fake agy binary');
const SHA = crypto.createHash('sha256').update(BODY).digest('hex');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-gemini-'));
  const root = path.join(dir, 'soul'); fs.mkdirSync(root);
  const env = { LOCALAPPDATA: path.join(dir, 'lad'), PATH: '' };
  let receipt = { installed: {} };
  return {
    dir, root, env,
    deps: { readReceiptFn: () => receipt, writeReceiptFn: (_r, v) => { receipt = JSON.parse(JSON.stringify(v)); } },
    receipt: () => receipt,
    done: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
const lockWith = (over = {}) => ({ parts: { gemini: { ...LOCK.parts.gemini, sha256: SHA, bytes: BODY.length, ...over } } });
const fakeDownload = (body = BODY) => async (url, dest, opts) => {
  fs.writeFileSync(dest, body);
  opts?.onProgress?.({ done: body.length, total: body.length });
  return { sha256: crypto.createHash('sha256').update(body).digest('hex'), bytes: body.length };
};

test('lock: gemini = url 형식 · 설치 중 내려받기 · 판 고정', () => {
  const p = LOCK.parts.gemini;
  assert.equal(p.kind, 'url');
  assert.equal(p.redistribute, 'download');
  assert.match(p.sha256, /^[0-9a-f]{64}$/);
  assert.match(p.sha512, /^[0-9a-f]{128}$/);
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.ok(p.url.includes(`/${p.version}-`), 'url 이 그 판의 고정 주소여야 한다');
});

test('받아서 공식 자리에 두고 영수증에 적는다 · agy install 을 부른다', async () => {
  const s = sandbox();
  try {
    const calls = [];
    const r = await installGemini({ root: s.root, lock: lockWith(), env: s.env, downloadFn: fakeDownload(), runFn: async (exe, args) => { calls.push([exe, args]); return { code: 0 }; }, ...s.deps });
    const target = agyTarget(s.env);
    assert.equal(r.ok, true); assert.equal(r.source, 'download'); assert.equal(r.path, target);
    assert.deepEqual(fs.readFileSync(target), BODY);
    assert.deepEqual(calls, [[target, ['install', '--skip-aliases']]]);
    assert.equal(s.receipt().installed.gemini.state, 'installed');
    assert.equal(s.receipt().installed.gemini.verified, true);
    assert.ok(!fs.existsSync(path.join(s.root, '_agent', 'shared', 'tools', 'agy')), '받는 자리(.part)는 정리한다');
  } finally { s.done(); }
});

test('지문이 다르면 두지 않고 실패(checksum) · .part 지움', async () => {
  const s = sandbox();
  try {
    const r = await installGemini({ root: s.root, lock: lockWith(), env: s.env, downloadFn: fakeDownload(Buffer.from('tampered')), runFn: async () => ({ code: 0 }), ...s.deps });
    assert.equal(r.ok, false); assert.equal(r.reason, 'checksum');
    assert.ok(!fs.existsSync(agyTarget(s.env)));
    const staging = path.join(s.root, '_agent', 'shared', 'tools', 'agy');
    assert.deepEqual(fs.existsSync(staging) ? fs.readdirSync(staging) : [], []);
    assert.equal(s.receipt().installed.gemini.state, 'failed');
  } finally { s.done(); }
});

test('이미 있는 agy 는 받지도 덮지도 않는다(공식 자리 · PATH)', async () => {
  for (const where of ['local', 'path']) {
    const s = sandbox();
    try {
      let exe;
      if (where === 'local') { exe = agyTarget(s.env); }
      else { const d = path.join(s.dir, 'bin'); s.env.PATH = d; exe = path.join(d, 'agy.exe'); }
      fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, 'mine');
      let downloaded = false;
      const r = await installGemini({ root: s.root, lock: lockWith(), env: s.env, downloadFn: async () => { downloaded = true; return {}; }, runFn: async () => { throw new Error('부르면 안 됨'); }, ...s.deps });
      assert.equal(r.ok, true); assert.equal(r.source, 'existing'); assert.equal(r.path, exe);
      assert.equal(downloaded, false);
      assert.equal(fs.readFileSync(exe, 'utf8'), 'mine');
      assert.equal(findAgy({ env: s.env }), exe);
    } finally { s.done(); }
  }
});

test('내려받기 실패 · 잠금 정보 없음 · agy install 실패는 각각', async () => {
  const s = sandbox();
  try {
    const a = await installGemini({ root: s.root, lock: lockWith(), env: s.env, downloadFn: async () => { throw new Error('ETIMEDOUT'); }, ...s.deps });
    assert.equal(a.reason, 'download'); assert.match(a.message, /핫스팟/);
    const b = await installGemini({ root: s.root, lock: { parts: {} }, env: s.env, ...s.deps });
    assert.equal(b.reason, 'lock-missing');
    const c = await installGemini({ root: s.root, lock: lockWith(), env: s.env, downloadFn: fakeDownload(), runFn: async () => { throw new Error('boom'); }, ...s.deps });
    assert.equal(c.ok, true, 'PATH 등록 실패는 설치 실패가 아니다');
  } finally { s.done(); }
});

test('agyModelsFrom: 머리줄은 버리고 이름만', () => {
  assert.deepEqual(agyModelsFrom('Fetching available models...\ngemini-4-neon-high\tGemini 4 Neon (High)\r\nclaude-x-4\tClaude X\n'), ['gemini-4-neon-high', 'claude-x-4']);
  assert.deepEqual(agyModelsFrom('Error: not signed in'), []);
});

// ---- 로그인 -------------------------------------------------------------
import { GeminiLogin, trustGeminiDir } from '../installer/lib/gemini.mjs';

function loginRig({ loggedInAfter = Infinity, windowLives = true } = {}) {
  const s = sandbox();
  const exe = agyTarget(s.env); fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, 'x');
  s.env.USERPROFILE = path.join(s.dir, 'home');
  let t = 1000; let checks = 0; const killed = []; const spawned = [];
  let live = new Set();
  const login = new GeminiLogin({
    root: s.root, env: s.env, now: () => t, checkEveryMs: 5000, timeoutMs: 60000,
    runFn: async (_exe, args) => { assert.deepEqual(args, ['models']); checks++; return checks > loggedInAfter ? { code: 0, out: 'Fetching...\ngemini-4-neon-high\tGemini 4 Neon (High)\n' } : { code: 1, out: 'not signed in' }; },
    spawnWindow: async (e, cwd) => { spawned.push([e, cwd]); live.add(4242); return 4242; },
    alive: (pid) => windowLives && live.has(pid),
    killTree: async (pid) => { killed.push(pid); live.delete(pid); },
  });
  const tick = async (ms) => { t += ms; login.status(); await login.checking; };
  return { s, exe, login, tick, killed, spawned, setLive: (v) => { windowLives = v; } };
}

test('로그인: 창을 띄우고 · 모델 목록이 나오면 끝 · 자기 창(PID)만 닫는다', async () => {
  const r = loginRig({ loggedInAfter: 1 });
  try {
    assert.equal((await r.login.start()).state, 'waiting');
    assert.equal(r.spawned[0][0], r.exe);
    assert.equal(r.spawned[0][1], path.join(r.s.root, '_agent', 'setup', 'gemini-login'));
    const st = JSON.parse(fs.readFileSync(path.join(r.s.env.USERPROFILE, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8'));
    assert.deepEqual(st.trustedWorkspaces, [r.spawned[0][1]]);
    await r.tick(5000); assert.equal(r.login.info().state, 'waiting');
    await r.tick(1000); assert.equal(r.login.info().state, 'waiting', '5초 안에는 다시 확인하지 않는다');
    await r.tick(5000); assert.equal(r.login.info().state, 'done');
    assert.deepEqual(r.killed, [4242]);
  } finally { r.s.done(); }
});

test('로그인: 창을 먼저 닫으면 closed · 시간 넘기면 timeout(창 닫음)', async () => {
  const a = loginRig();
  try {
    await a.login.start(); a.setLive(false);
    await a.tick(5000);
    assert.deepEqual([a.login.info().state, a.login.info().reason], ['failed', 'closed']);
  } finally { a.s.done(); }
  const b = loginRig();
  try {
    await b.login.start();
    await b.tick(61000);
    assert.deepEqual([b.login.info().state, b.login.info().reason], ['failed', 'timeout']);
    assert.deepEqual(b.killed, [4242]);
  } finally { b.s.done(); }
});

test('로그인: 이미 로그인된 PC 는 창 없이 끝 · agy 없으면 cli-missing · 건너뛰기', async () => {
  const a = loginRig({ loggedInAfter: 0 });
  try {
    assert.equal((await a.login.probe()).state, 'done');
    await a.login.start();
    assert.deepEqual(a.spawned, [], '이미 끝났으면 창을 띄우지 않는다');
  } finally { a.s.done(); }
  const b = loginRig();
  try {
    fs.rmSync(b.exe);
    assert.deepEqual([(await b.login.start()).state, b.login.info().reason], ['failed', 'cli-missing']);
  } finally { b.s.done(); }
  const c = loginRig();
  try {
    await c.login.start();
    assert.equal((await c.login.skip()).state, 'skipped');
    assert.deepEqual(c.killed, [4242]);
  } finally { c.s.done(); }
});

test('믿는 폴더 적기: 다른 설정은 지키고 · 같은 폴더는 한 번만 · 못 읽으면 건드리지 않음', () => {
  const s = sandbox();
  try {
    const home = path.join(s.dir, 'agyhome'); fs.mkdirSync(home);
    const f = path.join(home, 'settings.json');
    fs.writeFileSync(f, JSON.stringify({ theme: 'dark', trustedWorkspaces: ['C:\A'] }));
    assert.equal(trustGeminiDir(path.join(s.dir, 'w'), home), 'appended');
    assert.equal(trustGeminiDir(path.join(s.dir, 'w'), home), 'unchanged');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(j.theme, 'dark'); assert.equal(j.trustedWorkspaces.length, 2);
    fs.writeFileSync(f, '{broken');
    assert.equal(trustGeminiDir(path.join(s.dir, 'v'), home), 'skipped:unreadable');
    assert.equal(fs.readFileSync(f, 'utf8'), '{broken');
  } finally { s.done(); }
});
