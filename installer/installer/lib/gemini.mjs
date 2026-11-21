// 세 번째 AI = Gemini(Antigravity CLI `agy`) — 설치기 온라인 단계 몫 (P18, 2026-11-21 사용자 결정).
//
// 결정(확인용\Gemini-설치연결-시안.html):
//   · 판 고정 — lock.parts.gemini 의 주소·SHA-256(공식 SHA-512 와 같은 파일임을 실측)으로만 받는다.
//   · 고른 사람만 — 구독 고르기에서 「Google AI Pro(Gemini)」를 고른 설치만 받고 로그인한다.
//   · 설치 자리 = agy 공식 자리 %LOCALAPPDATA%\agy\bin\agy.exe (agy 가 스스로 업데이트하는 자리 —
//     「부품은 _agent\shared\tools 안에서만」의 사용자 승인 예외). 받는 동안만 tools\agy 에 .part 로 둔다.
//   · 이미 agy 가 있는 PC 는 건드리지 않는다(덮어쓰지 않음 — 그 PC 의 agy 가 더 새 판일 수 있다).
//   · 실패해도 설치 전체를 막지 않는다(서버가 경고로만 다룬다).
//
// 로그인은 agy 에 따로 명령이 없다 — 처음 켜면 브라우저로 구글 로그인을 연다. 로그인 여부는
// `agy models` 가 모델 목록을 내는지로 본다(질문을 보내지 않으므로 구독 사용량을 쓰지 않는다).
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../lib/run.mjs';
import { readReceipt, writeReceipt, setInstalled } from './receipt.mjs';

export const GEMINI_CODE = 'E-ONLINE-GEMINI';
export const GEMINI_INSTALL_TIMEOUT_MS = 60000;

/** agy 공식 설치 자리. LOCALAPPDATA 가 없으면 null. */
export function agyTarget(env = process.env, binName = 'agy.exe') {
  const base = env.LOCALAPPDATA;
  return base ? path.join(base, 'agy', 'bin', binName) : null;
}

/** 이 PC 에 이미 있는 agy(공식 자리 → PATH). 없으면 null. IRIS 창 daemon/agents.mjs agyExe() 와 같은 순서. */
export function findAgy({ env = process.env, existsSync = fs.existsSync } = {}) {
  const local = agyTarget(env);
  if (local && existsSync(local)) return local;
  for (const dir of String(env.PATH || env.Path || '').split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir, 'agy.exe');
    if (existsSync(f)) return f;
  }
  return null;
}

/** `agy models` 출력 → 모델 이름 목록(한 줄 = "<이름>\t<보이는 이름>"). IRIS 창 models.mjs agyModelsFrom 과 같은 규칙. */
export function agyModelsFrom(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([a-z0-9][a-z0-9.-]{2,80})\t(.+)$/.exec(line.trim().replace(/ {2,}/g, '\t'));
    if (m) out.push(m[1]);
  }
  return out;
}

function recordGemini(root, info, { readReceiptFn = readReceipt, writeReceiptFn = writeReceipt } = {}) {
  try {
    const receipt = readReceiptFn(root);
    if (!receipt) return;
    receipt.installed = receipt.installed ?? {};
    setInstalled(receipt, 'gemini', info);
    writeReceiptFn(root, receipt);
  } catch { /* 영수증을 못 써도 온라인 단계는 화면 상태가 기준 */ }
}

function moveFile(fsImpl, from, to) {
  try { fsImpl.renameSync(from, to); return; } catch (e) {
    if (e?.code !== 'EXDEV') throw e;
  }
  fsImpl.copyFileSync(from, to);
  fsImpl.unlinkSync(from);
}

/**
 * Gemini 프로그램을 받아 공식 자리에 둔다.
 * @returns {Promise<{ok:boolean, state:'done'|'failed', source?:'existing'|'download', version?:string, path?:string, code?:string, reason?:string, message?:string}>}
 */
export async function installGemini({
  root, lock, env = process.env,
  downloadFn, fetchFn = fetch, runFn = run, fsImpl = fs,
  onProgress = () => {}, log = () => {},
  readReceiptFn = readReceipt, writeReceiptFn = writeReceipt,
} = {}) {
  const deps = { readReceiptFn, writeReceiptFn };
  const fail = (reason, message, extra = {}) => {
    recordGemini(root, { state: 'failed', reason, verified: false, active: false }, deps);
    log(`gemini install failed: ${reason}${extra.detail ? ` ${extra.detail}` : ''}`);
    return { ok: false, state: 'failed', code: GEMINI_CODE, reason, message, ...extra };
  };

  const part = lock?.parts?.gemini;
  if (!part?.version || !part?.url || !/^[0-9a-f]{64}$/.test(String(part?.sha256 || ''))) {
    return fail('lock-missing', 'Gemini 프로그램 내려받기 정보를 찾지 못했습니다.');
  }
  const binName = part.binName || 'agy.exe';

  const existing = findAgy({ env, existsSync: (p) => fsImpl.existsSync(p) });
  if (existing) {
    log(`gemini already installed at ${existing} — 건드리지 않음`);
    recordGemini(root, { state: 'installed', source: 'existing', path: existing, verified: false, active: true }, deps);
    return { ok: true, state: 'done', source: 'existing', path: existing };
  }

  const target = agyTarget(env, binName);
  if (!target) return fail('no-localappdata', '이 컴퓨터의 사용자 폴더(LOCALAPPDATA)를 찾지 못해 Gemini 프로그램을 둘 곳이 없습니다.');

  const staging = path.join(root, ...String(part.dest || '_agent/shared/tools/agy').split('/').filter(Boolean));
  const partPath = path.join(staging, `agy-${part.version}.exe.part`);
  if (!downloadFn) ({ downloadToFile: downloadFn } = await import('./online.mjs'));

  let got;
  try {
    fsImpl.mkdirSync(staging, { recursive: true });
    onProgress({ phase: 'download', source: 'google', done: 0, total: part.bytes ?? null });
    got = await downloadFn(part.url, partPath, {
      fetchFn, env, expectedBytes: part.bytes ?? null,
      onProgress: ({ done, total }) => onProgress({ phase: 'download', source: 'google', done, total: total ?? part.bytes ?? null }),
    });
  } catch (e) {
    try { fsImpl.rmSync(partPath, { force: true }); } catch { /* 없음 */ }
    return fail('download', 'Gemini 프로그램을 받지 못했습니다. 학교·회사 인터넷이 storage.googleapis.com 을 막을 수 있습니다 — 휴대폰 핫스팟에서 다시 해 주세요.', { detail: String(e?.message ?? e).slice(0, 200) });
  }

  if (String(got?.sha256 || '').toLowerCase() !== part.sha256.toLowerCase()) {
    try { fsImpl.rmSync(partPath, { force: true }); } catch { /* 없음 */ }
    return fail('checksum', '받은 Gemini 프로그램의 지문이 정해 둔 값과 달라 설치하지 않았습니다.', { detail: `got=${got?.sha256 ?? 'none'} want=${part.sha256}` });
  }

  try {
    fsImpl.mkdirSync(path.dirname(target), { recursive: true });
    if (fsImpl.existsSync(target)) { // 받는 사이에 누가 깔았다 — 덮지 않는다
      try { fsImpl.rmSync(partPath, { force: true }); } catch { /* 없음 */ }
      recordGemini(root, { state: 'installed', source: 'existing', path: target, verified: false, active: true }, deps);
      return { ok: true, state: 'done', source: 'existing', path: target };
    }
    moveFile(fsImpl, partPath, target);
  } catch (e) {
    try { fsImpl.rmSync(partPath, { force: true }); } catch { /* 없음 */ }
    return fail('write', 'Gemini 프로그램을 제자리에 두지 못했습니다(백신이 막았을 수 있습니다).', { detail: String(e?.message ?? e).slice(0, 200) });
  }
  try { fsImpl.rmdirSync(staging); } catch { /* 비어 있지 않으면 둔다 */ }

  // 공식 install.ps1 의 마지막 단계와 같은 `agy install`(사용자 PATH 등록). 실패해도 설치는 된 것 —
  // IRIS 창은 공식 자리를 먼저 보므로 PATH 없이도 찾는다. 별칭 정리(셸 프로필 고치기)는 건너뛴다.
  try {
    const r = await runFn(target, ['install', '--skip-aliases'], { timeoutMs: GEMINI_INSTALL_TIMEOUT_MS });
    log(`gemini agy install code=${r?.code}`);
  } catch (e) { log(`gemini agy install skipped: ${String(e?.message ?? e).slice(0, 120)}`); }

  recordGemini(root, {
    state: 'installed', source: 'download', version: part.version, path: target,
    sha256: part.sha256, verified: true, active: true,
  }, deps);
  log(`gemini installed version=${part.version} at ${target}`);
  return { ok: true, state: 'done', source: 'download', version: part.version, path: target };
}

// ---------------------------------------------------------------------------
// 로그인 — 보이는 검은 창에 agy 를 띄우면 agy 가 브라우저로 구글 로그인을 연다.
// 설치기는 `agy models` 로 로그인을 알아채고, 자기가 띄운 그 창(PID)만 닫는다.
// ---------------------------------------------------------------------------

export const GEMINI_LOGIN_TIMEOUT_MS = 5 * 60_000;
export const GEMINI_CHECK_EVERY_MS = 5000;
export const GEMINI_MODELS_TIMEOUT_MS = 25000;

/** agy 자료 폴더(신뢰 목록 settings.json). IRIS 창 daemon/agents.mjs AGY_HOME 과 같은 자리. */
export function agyHome(env = process.env) {
  if (env.IRIS_AGY_HOME) return env.IRIS_AGY_HOME;
  const home = env.USERPROFILE || env.HOME;
  return home ? path.join(home, '.gemini', 'antigravity-cli') : null;
}

/** 로그인 창을 여는 빈 폴더를 미리 「믿는 폴더」로 적는다 — 물음 창이 로그인보다 먼저 뜨지 않게(IRIS 창 trust.mjs trustGemini 와 같은 규칙). */
export function trustGeminiDir(dir, home, { fsImpl = fs } = {}) {
  if (!home) return 'skipped:no-home';
  const file = path.join(home, 'settings.json');
  let data = {};
  if (fsImpl.existsSync(file)) {
    try { data = JSON.parse(fsImpl.readFileSync(file, 'utf8')); } catch { return 'skipped:unreadable'; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'skipped:unreadable';
  }
  const list = Array.isArray(data.trustedWorkspaces) ? data.trustedWorkspaces : [];
  const norm = (p) => path.resolve(String(p)).replace(/[\/]+$/, '').toLowerCase();
  const want = path.resolve(dir);
  if (list.some((p) => norm(p) === norm(want))) return 'unchanged';
  fsImpl.mkdirSync(home, { recursive: true });
  const tmp = `${file}.iris-tmp`;
  fsImpl.writeFileSync(tmp, JSON.stringify({ ...data, trustedWorkspaces: [...list, want] }, null, 2), 'utf8');
  fsImpl.renameSync(tmp, file);
  return list.length ? 'appended' : 'created';
}

/** 로그인돼 있으면 모델 목록이 나온다. { loggedIn, models, code } — 던지지 않는다. */
export async function geminiLoggedIn({ exe, runFn = run, timeoutMs = GEMINI_MODELS_TIMEOUT_MS } = {}) {
  if (!exe) return { loggedIn: false, models: 0, code: null, reason: 'cli-missing' };
  try {
    const r = await runFn(exe, ['models'], { timeoutMs });
    const models = agyModelsFrom(`${r?.out ?? ''}\n${r?.err ?? ''}`);
    return { loggedIn: models.length > 0, models: models.length, code: r?.code ?? null, timedOut: r?.timedOut === true };
  } catch (e) {
    return { loggedIn: false, models: 0, code: null, reason: String(e?.message ?? e).slice(0, 120) };
  }
}

function defaultSpawnWindow(exe, cwd) {
  // detached + 창 숨기지 않음 = 콘솔 프로그램이 제 검은 창을 새로 얻는다. 설치기는 PID 만 쥔다.
  return import('node:child_process').then(({ spawn }) => {
    const child = spawn(exe, [], { cwd, detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {});
    child.unref();
    return child.pid ?? null;
  });
}

function defaultAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
}

function defaultKillTree(pid) {
  if (!pid) return Promise.resolve();
  return run('taskkill', ['/PID', String(pid), '/T', '/F'], { timeoutMs: 15000 }).catch(() => {});
}

/**
 * 한 설치 안의 Gemini 로그인 하나. 서버가 하나 만들어 쥐고 status() 를 폴링 때마다 부른다.
 * 상태: idle → waiting(창 띄움) → done | failed(reason: cli-missing·closed·timeout·spawn).
 */
export class GeminiLogin {
  constructor({ root, env = process.env, runFn = run, spawnWindow = defaultSpawnWindow, alive = defaultAlive, killTree = defaultKillTree,
    fsImpl = fs, now = () => Date.now(), log = () => {}, timeoutMs = GEMINI_LOGIN_TIMEOUT_MS, checkEveryMs = GEMINI_CHECK_EVERY_MS } = {}) {
    Object.assign(this, { root, env, runFn, spawnWindow, alive, killTree, fsImpl, now, log, timeoutMs, checkEveryMs });
    this.s = { state: 'idle', reason: null, startedAt: null, pid: null, checkedAt: 0 };
    this.checking = null;
  }

  info() { const { state, reason, startedAt } = this.s; return { state, reason, startedAt }; }

  /** 이미 로그인돼 있는가만 본다(창 없음). 깔자마자 한 번 — 원래 agy 를 쓰던 PC 는 여기서 끝난다. */
  async probe() {
    const exe = findAgy({ env: this.env, existsSync: (p) => this.fsImpl.existsSync(p) });
    const r = await geminiLoggedIn({ exe, runFn: this.runFn });
    if (r.loggedIn) { this.s = { ...this.s, state: 'done', reason: 'already' }; this.log(`gemini login: already (${r.models} models)`); }
    return this.info();
  }

  async start() {
    const exe = findAgy({ env: this.env, existsSync: (p) => this.fsImpl.existsSync(p) });
    if (!exe) { this.s = { ...this.s, state: 'failed', reason: 'cli-missing' }; return this.info(); }
    if (this.s.state === 'done') return this.info();
    await this.closeWindow();
    const dir = path.join(this.root, '_agent', 'setup', 'gemini-login');
    try {
      this.fsImpl.mkdirSync(dir, { recursive: true });
      this.log(`gemini login trust: ${trustGeminiDir(dir, agyHome(this.env), { fsImpl: this.fsImpl })}`);
    } catch (e) { this.log(`gemini login trust skipped: ${String(e?.message ?? e).slice(0, 120)}`); }
    let pid = null;
    try { pid = await this.spawnWindow(exe, dir); } catch (e) { this.log(`gemini login spawn failed: ${String(e?.message ?? e).slice(0, 120)}`); }
    if (!pid) { this.s = { ...this.s, state: 'failed', reason: 'spawn' }; return this.info(); }
    this.s = { state: 'waiting', reason: null, startedAt: this.now(), pid, checkedAt: 0 };
    this.log(`gemini login window pid=${pid}`);
    return this.info();
  }

  /** 폴링마다 부른다. 확인(agy models)은 뒤에서 checkEveryMs 마다 한 번 — 폴링 응답을 붙잡지 않는다. */
  status() {
    const s = this.s;
    if (s.state !== 'waiting' || this.checking) return this.info();
    const t = this.now();
    if (t - s.checkedAt < this.checkEveryMs) return this.info();
    s.checkedAt = t;
    this.checking = (async () => {
      const exe = findAgy({ env: this.env, existsSync: (p) => this.fsImpl.existsSync(p) });
      const r = await geminiLoggedIn({ exe, runFn: this.runFn });
      if (this.s !== s || s.state !== 'waiting') return;
      if (r.loggedIn) {
        s.state = 'done'; s.reason = null;
        this.log(`gemini login done (${r.models} models)`);
        await this.closeWindow();
      } else if (!this.alive(s.pid)) {
        s.state = 'failed'; s.reason = 'closed'; s.pid = null;
        this.log('gemini login window closed before sign-in');
      } else if (this.now() - s.startedAt > this.timeoutMs) {
        s.state = 'failed'; s.reason = 'timeout';
        this.log('gemini login timed out');
        await this.closeWindow();
      }
    })().catch(() => {}).finally(() => { this.checking = null; });
    return this.info();
  }

  skip() {
    if (this.s.state !== 'done') this.s = { ...this.s, state: 'skipped', reason: null };
    return this.closeWindow().then(() => this.info());
  }

  /** 자기가 띄운 창(PID)만 닫는다 — 이름으로 끄지 않는다. */
  async closeWindow() {
    const pid = this.s.pid;
    if (!pid) return;
    this.s.pid = null;
    if (this.alive(pid)) await this.killTree(pid);
  }
}
