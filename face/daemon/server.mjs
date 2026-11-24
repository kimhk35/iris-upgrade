// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// IRIS 세션 데몬 — 127.0.0.1:3458 (HTTP 정적+API, WebSocket /ws). 단일 실행, PID 파일.
// 조합(에이전트·모델·사고깊이)은 사용자가 고른 그대로 CLI에 넘긴다. 자동 판정 없음(2026-09-09 폐기).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { SessionManager, autoResumeState } from './sessions.mjs';
import { titleFromPrompt } from './title.mjs';
import { AGENTS, setModelRefresher, agyExe, AGY_HOME } from './agents.mjs';
import { GeminiUsage } from './geminiusage.mjs';
import { ModelCatalog } from './models.mjs';
import { TranscriptTail } from './transcript.mjs';
import { SubagentWatcher } from './subagents.mjs';
import { listFolders, checkFresh, RecentFolders } from './folders.mjs';
import { readLimits } from './limits.mjs';
import { findRoot, rootName, Settings } from './workspace.mjs';
import { dashDir, dashPort, sweeperPath, pythonExe } from './paths.mjs';
import { MemoryMonitor } from './memory.mjs';
import { toPdf, isConvertible } from './doc2pdf.mjs';
import { openPages, pageFile, pageHashes, sweepCache, ID_RE } from './docpages.mjs';
import { Voice } from './voice.mjs';
import { activeAgentsMap, sleepingAgents, agentStatus, wake, SleepWatcher, KNOWN_AGENTS } from './wake.mjs';
import { ModuleHost, NAME_RE } from './modules.mjs';
import { inspectZip, installZip, removeModule } from './modinstall.mjs';
import { loadCatalog, mergeCatalog, fetchReleaseZip } from './catalog.mjs';
import { Updater } from './update.mjs';
import { Finalizer } from './finalize.mjs';
import { SetupProgress } from './progress.mjs';
import { HandoffFlow, relayReady } from './handoff.mjs';
import { planStructure, createStructure, runOntology, ontologyPython, ontologyGraph, listTools, listExisting } from './tutorial.mjs';
import { AuthWatch } from './auth.mjs';
import { sweepUploads, UPLOAD_KEEP_DAYS } from './uploads.mjs';
import { ToolManager, makeRunner } from './toolinstall.mjs';
import { childEnv } from './sessions.mjs';
import { CLAUDE_CONFIG_DIR, CODEX_HOME } from './agents.mjs';
import { LocalUsage } from './usage.mjs';
import { ShareMeter } from './share.mjs';
import { Profiles } from './profiles.mjs';
import { taskkillTree, pidAlive } from './proctree.mjs';

const PORT = Number(process.env.IRIS_FACE_PORT) || 3458;          // 시험용 두 번째 데몬: IRIS_FACE_PORT=3459 IRIS_FACE_STATE=<폴더>
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 버전·만든 사람·명함·허가서의 원천은 package.json 한 곳(2026-09-10 각인). 화면·창 제목·정보 대화상자는 전부 /api/health 로 이 값을 읽는다.
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
export const VERSION = PKG.version;
export const ABOUT = Object.freeze({ name: 'IRIS', version: PKG.version, author: PKG.author, homepage: PKG.homepage, license: PKG.license, since: PKG.iris?.since, motto: PKG.iris?.motto });
const STATE = process.env.IRIS_FACE_STATE || path.join(ROOT, 'state');
const APP = path.join(ROOT, 'app');
const PID_FILE = path.join(STATE, 'daemon.pid');
const LOG_FILE = path.join(STATE, 'daemon.log');
fs.mkdirSync(STATE, { recursive: true });
// 데몬 기록은 1MB 를 넘으면 daemon.log.1 로 넘기고 새로 시작한다(P18 점검 — 크기 제한이 없어 몇 달 쓰면 수백 MB). 실행기 launch.log 와 같은 규칙.
// 크기는 100번 쓸 때마다 한 번만 잰다. 신고 묶음은 이 파일의 꼬리만 읽으므로 넘긴 직후에도 최근 줄은 남는다.
export const LOG_MAX_BYTES = 1024 * 1024;
let logWrites = 0;
const log = (msg) => {
  try {
    if (++logWrites % 100 === 1 && fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) {
      fs.rmSync(`${LOG_FILE}.1`, { force: true }); fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
  } catch { /* 넘기기 실패는 기록을 막지 않는다 */ }
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`, 'utf8');
};

// ---- sessions + ws fan-out ----
const clients = new Set();
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
// 개인 공간(P18): 공간 주인이 있는 세션은 그 공간 열쇠를 든 화면에만 내용을 보낸다(잠긴 화면에는 「잠긴 세션」 껍데기만)
const profiles = new Profiles({ file: path.join(STATE, 'profiles.json') });
const canSee = (rec, pid) => !rec?.owner || rec.owner === pid;
const listFor = (pid) => sm.list().map((r) => (canSee(r, pid) ? { ...r } : { id: r.id, owner: r.owner, locked: true, status: r.status, agent: r.agent, createdAt: r.createdAt }));
const broadcast = (obj) => { const rec = obj && obj.id ? sm.get(obj.id) : null; for (const c of clients) if (!rec?.owner || canSee(rec, c.profile)) send(c, obj); };
const broadcastSessions = () => { for (const c of clients) send(c, { type: 'sessions', list: listFor(c.profile) }); };
const publicList = () => listFor(null);
const sm = new SessionManager(STATE, {
  onOutput: (id, data) => { for (const c of clients) if (c.attached === id) send(c, { type: 'output', id, data }); },
  onStatus: (id, status, extra) => { finalizer?.touch(); broadcast({ type: 'status', id, status, ...(extra || {}) }); }, // extra.done = 작업 완료 전환(화면 알림, 2026-09-11) · touch = 마무리 자동 실행의 "조용한 시간" 측정(v2.60)
  onActivity: (id, text) => { for (const c of clients) if (c.attached === id) send(c, { type: 'activity', id, text }); },
  onPrompt: (id, prompt) => broadcast({ type: 'prompt', id, prompt }), // 확인 카드(v2.43): 노란불의 질문·선택지, null = 카드 내림. 세션 목록(publicList)에도 rec.prompt 로 실린다.
  onList: () => broadcastSessions(),
  onLog: (msg) => log(msg),
  // v2.73: 대화 기록의 차례가 열려 있는가(transcript.mjs turnState) — 화면 글자 판정의 교차 확인(sessions.mjs idleCheck). 기록이 없으면 null.
  turnOpen: (id) => { const tl = tails.get(id); if (!tl) return null; const s = tl.turnState(); return s == null ? null : s === 'open'; },
});
const recent = new RecentFolders(STATE);
const WS_ROOT = findRoot(ROOT); const settings = new Settings(STATE);
// 도구 설치·제거(판 B, 2026-11-10 — docs\설계-도구화면-2026-11-10.md): 엄선 목록만, 세션과 같은 환경으로 공식 CLI 실행.
// 살아 있는 세션 수 = 파일 삭제를 미루는 기준(세션이 지운 파일을 나중에 부르지 않게).
// 이 PC 사용량(P18) — 구독 계정을 여러 PC 가 나눠 쓸 때 이 PC 몫을 보이게(기록 파일만 읽음)
const localUsage = new LocalUsage({ claudeDir: CLAUDE_CONFIG_DIR, codexHome: CODEX_HOME });
const tools = new ToolManager({
  root: WS_ROOT, claudeDir: CLAUDE_CONFIG_DIR, codexDir: CODEX_HOME, cacheDir: path.join(STATE, 'tools-cache'),
  run: makeRunner({ env: childEnv(), killTree: taskkillTree }), log: (m) => log(m), broadcast: (o) => broadcast(o),
  // orphan = 데몬이 다시 떠서 직접 붙잡지 못했지만 PID 가 살아 있던 세션 — 그 세션도 도구를 쓰므로 센다(코덱스 코드 검토 2차 B5).
  // orphan 표시는 시작 때 한 번 정해져 그대로 남으므로 PID 가 지금도 살아 있을 때만(안 그러면 「제거 대기」가 영영 안 풀림).
  liveSessions: () => sm.list().filter((r) => ['busy', 'idle', 'attention'].includes(r.status) || (r.status === 'orphan' && pidAlive(r.pid))).length,
});
// 세팅 마무리 자동 실행(v2.60): soul-state.json 이 pending-finalize 면 세션을 닫고 finalize-pipeline.ps1 을 돌린 뒤 이어 연다(finalize.mjs).
var finalizer = new Finalizer({ root: WS_ROOT, sm, stateDir: STATE, log, broadcast });
// 세팅 진행 막대(v2.65): 가이드가 기록하는 _agent\setup\setup-progress.json 을 읽어 화면 위에 그린다(progress.mjs).
const setupProgress = new SetupProgress({ root: WS_ROOT, broadcast, log });
// 인수 문서(설치 패키지 v2, P03 Task 21): `_agent\setup\handoff.json` 이 있으면 첫 실행을 여기서 가른다 —
// ready 면 주도 에이전트에 firstMessage 를 그대로 보내고, 아니면 안내 카드 + 「설치 이어하기」. 없으면(1.x) 아무 일도 하지 않는다.
// v2.90: ready 면 첫 세션을 자동으로 열지 않고 튜토리얼(화면)을 띄운다. relayReady 는 튜토리얼 「첫 대화 해 보기」·새 세션 전 확인에 쓴다(GET /api/relay/ready).
const handoff = new HandoffFlow({ root: WS_ROOT, stateDir: STATE, sm, log, broadcast });
const voice = new Voice(STATE, settings, log);   // 🎤 로컬 위스퍼 워커(자식 PID 하나) — 시작 때 모델 미리 올림
// 에이전트 자가 치유·계정 감시(v2.76): 시작 때 한 번 + 15초마다 — 프로그램이 있는 잠든/빠진 에이전트를 켜고,
// 계정 수·프로그램 없음이 바뀌면 화면에 알린다. 영수증이 없는 PC(이 개발 PC 포함)에서는 무동작.
const agentsMsg = (status = agentStatus()) => ({ type: 'agents', agents: activeAgentsMap(AGENTS), sleeping: status.sleeping, status });
const sleepWatcher = new SleepWatcher({
  log: (m) => log(`wake: ${m}`),
  onChange: (status) => broadcast(agentsMsg(status)),
});
sleepWatcher.start();
// 🔴 모델 이름 = 실제 모델(v2.102, 2026-11-10 사용자 지정): 그 PC 의 claude 실행 파일·코덱스 모델 목록에서 선택 칸을 만든다.
// 시작 때 한 번(실행 파일이 그대로면 저장해 둔 결과, 처음·업데이트 뒤엔 0.3~2초 읽기) + 세션 만들기 직전(normalize) + 10분마다.
const models = new ModelCatalog({ AGENTS, env: () => childEnv(), codexHome: CODEX_HOME, cacheFile: path.join(STATE, 'model-scan.json'), log: (m) => log(m), agyExe: () => agyExe(childEnv()) });
setModelRefresher(() => { if (models.refresh()) broadcast(agentsMsg()); models.refreshGemini({ onChange: () => broadcast(agentsMsg()) }); }); // Gemini 목록은 뒤에서(P18)
models.refreshGemini({ force: true, onChange: () => broadcast(agentsMsg()) }); // 켜자마자 한 번 — 처음 PC 도 손 표 3개가 아니라 agy 목록으로
// Gemini 사용량(P18 2026-11-19): 10분마다 agy /usage 화면을 숨은 터미널로 읽어 stategemini-usage.json — 대시보드 GEMINI 칸·머리줄 배터리. 끄기 = IRIS_FACE_GEMINI_USAGE=0
const geminiUsage = new GeminiUsage({ stateDir: STATE, agyExe: () => agyExe(childEnv()), agyHome: AGY_HOME, env: () => childEnv(), log: (m) => log(m), intervalMs: process.env.IRIS_FACE_GEMINI_USAGE === '0' ? 0 : 600000 });
geminiUsage.start();
try { const n = sweepCache(path.join(STATE, 'doc-cache')); if (n) log(`doc-cache: 오래된 미리보기 ${n}개 정리`); } catch {}
try { models.refresh({ force: true }); log(`models: claude=${models.info().claude.source} ${AGENTS.claude.models.map((m) => `${m.id}=${m.label}`).join(', ')}`); } catch (e) { log(`models init error: ${e?.message || e}`); }
setInterval(() => { try { if (models.refresh()) broadcast(agentsMsg()); } catch {} }, 10 * 60_000).unref();
// ---- 모듈 콘센트(계약 v1, 2026-09-11): modules\<이름>\ 을 별 프로세스로. 모듈이 없으면 아무것도 하지 않는다(바깥 연결 0 = verify:nomodule). ----
const MODULES_DIR = process.env.IRIS_FACE_MODULES || path.join(ROOT, 'modules');
const mods = new ModuleHost({
  dir: MODULES_DIR, faceVersion: VERSION, log,
  onChange: () => broadcast({ type: 'modules', list: uiModules() }),
  onNotify: (n) => { log(`module notify ${n.module}: ${n.title}`); broadcast({ type: 'module-notify', ...n }); },
  theme: () => ({ id: settings.get()?.theme || 'indigo', mode: 'dark' }),
  denyPorts: [PORT, dashPort()].filter(Boolean), // 모듈이 panel로 본체·대시보드 자기 포트를 내놓는 것 거부(F5)
});
// 화면(헤더 버튼·설정)에 주는 모듈 목록 = 공식 카탈로그 + 설치 여부 + 콘센트 상태(v2.56, 2026-09-13: 헤더는 미설치 모듈도 항상 보인다).
// 카탈로그는 저장소 안 정적 파일이라 바깥 연결이 없다(verify:nomodule). 설치된 것만 보려면 GET /api/modules(원본 mods.list()).
const uiModules = () => mergeCatalog(loadCatalog(), mods.list());

// ---- TeamClaude 대시보드 뷰어 서버(3457) 보장 — 한도 서랍을 열 때 화면이 부른다(POST /api/dash/ensure) ----
// 도구 폴더가 없는 PC(공개 배포본)면 alive:false 로 답하고 아무것도 띄우지 않는다. 브라우저는 열지 않는다.
// 폴더 탐색은 paths.mjs dashDir()(TEAMCLAUDE_DASH_DIR → 공유 도구 → 옛 자리) 한 곳.
const dashBase = dashDir();
// 공유 계정 「내 몫」(P18): 중계기 대시보드가 있는 PC 에서만 1분마다 계정 사용률·이 PC 요청을 보고 내 몫을 쌓는다
const shareMeter = new ShareMeter({ file: path.join(STATE, 'share.json'), log, fetchStatus: async () => { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500); try { const r = await fetch(`http://127.0.0.1:${dashPort()}/api/status`, { signal: ctl.signal }); return r.ok ? await r.json() : null; } finally { clearTimeout(t); } } });
if (dashBase) { setTimeout(() => shareMeter.sample(), 5000).unref?.(); setInterval(() => shareMeter.sample(), 60000).unref?.(); }
const DASH_ENSURE = dashBase ? path.join(dashBase, 'ensure-dash.mjs') : null;
const DASH_AVAILABLE = !!(DASH_ENSURE && fs.existsSync(DASH_ENSURE));
async function ensureDash() {
  if (!DASH_AVAILABLE) return { alive: false, port: null, started: false, message: 'dashboard tool not installed' };
  try { const { ensureDash } = await import(pathToFileURL(DASH_ENSURE).href); return await ensureDash({ log: (m) => log(`dash: ${m}`) }); }
  catch (e) { return { alive: false, port: null, started: false, message: `dashboard ensure failed: ${e.message}` }; }
}
// 선택 기능 표 — 화면이 /api/health.features 로 읽어 없는 기능(배터리·Ctrl+D 서랍·🎤)을 숨기거나 안내만 한다(2026-09-11 매듭 풀기).
// voice 는 데몬 시작 뒤 probe 가 끝나기 전엔 null(확인 중) → 화면은 null 을 "있음"으로 보고, /api/voice/status 로 다시 확인한다.
// ---- 로그인 열쇠 만료 감시(v2.84): 도구(iris-auth)가 있을 때만. 30분마다 점검 + 곧 만료면 윈도 알림(도구가 띄움) + 화면 방송 {type:'auth'}. ----
const auth = new AuthWatch({ log: (m) => log(m), broadcast: (o) => broadcast(o), ensureDash });
const features = () => ({ auth: auth.available, memory: memory.features(), dashboard: DASH_AVAILABLE, dashPort: dashPort(), voice: voice.status().available, python: !!voice.py, modules: uiModules(), update: { mode: updater.mode, enabled: updater.enabled } });

// ---- 업데이트(설계 2·3·4절, v2.58): 하루 1회 릴리스 확인 → 사용자가 누르면 받기·검증 → 메신저는 이 자리, IRIS 창·구조판은 적용기에 넘김. ----
// 데몬은 자기 파일을 바꾸지 않는다. 화면에 줄 진행은 웹소켓 {type:'update', …} 방송.
const updater = new Updater({
  stateDir: STATE, modulesDir: MODULES_DIR, faceRoot: ROOT, daemonPort: PORT,
  log: (m) => log(m), broadcast: (o) => broadcast(o),
  installMessenger: (buf) => installFromBuffer(buf, { allow: false, via: 'update' }),
});
// ---- 메모리 계기판(v2.78, 2026-10-04): 실제 RAM·커밋 2초마다 → 최근 30분 → {type:'mem'} 방송. 시작은 listen 뒤(memory.mjs). ----
// 많이 차지하는 것의 세션 묶음에는 살아 있는 세션만 넘긴다 — 끝난 세션의 PID 는 윈도가 다른 프로그램에 다시 쓴다.
const memory = new MemoryMonitor({ log, broadcast, sessions: () => sm.list().filter(r => sm.live.has(r.id)).map(r => ({ id: r.id, title: r.title, pid: r.pid })), sweeper: sweeperPath(), python: () => pythonExe() });
let updateResult = null; // 적용기가 남긴 결과(첫 화면에 한 번만 토스트)

// ---- transcript tails (기록파일 읽기 전용, 폴링) ----
// 폴링 간격은 두 단계(2026-09-10): 작업 중·확인 필요·요청을 보낸 직후 15초 = 0.3초(터미널처럼 바로 반영), 그 밖(대기·종료) = 1.5초.
// 읽기는 stat 한 번 + 새로 붙은 바이트만이라 빠른 간격도 비용이 거의 없다.
const POLL_FAST_MS = 300, POLL_SLOW_MS = 1500, HOT_AFTER_SEND_MS = 15000;
const tails = new Map();
const hotUntil = new Map(); // 세션 id → 이 시각까지는 빠르게 읽는다(요청 전송 직후)
const tailMeta = (tl) => ({ model: tl.model, usage: tl.lastUsage, unknown: tl.unknown, window: tl.contextWindow() });
function tailFor(rec) {
  if (!rec?.recordPath) return null;
  let tl = tails.get(rec.id);
  if (!tl || tl.file !== rec.recordPath) { tl = new TranscriptTail(rec.recordPath, rec.agent); tails.set(rec.id, tl); }
  return tl;
}
function pumpTail(rec) {
  const tl = tailFor(rec); if (!tl) return null;
  tl.polledAt = Date.now();
  let items; try { items = tl.poll(); } catch { return tl; }
  syncTitle(rec, tl);
  if (tl.reset) { tl.reset = false; broadcast({ type: 'transcript', id: rec.id, reset: true, items: tl.items, meta: tailMeta(tl) }); return tl; }
  if (items.length) for (const c of clients) if (c.attached === rec.id) send(c, { type: 'transcript', id: rec.id, items, meta: tailMeta(tl) });
  return tl;
}
// 작업목록 이름: 클로드 ai-title이 있으면 그것(ai), 없고 이름도 없으면 기록의 첫 요청문(first) — 이름이 바뀌면 sm.setTitle이 목록을 방송한다
function syncTitle(rec, tl) {
  if (tl.aiTitle) { if (sm.setTitle(rec.id, tl.aiTitle, 'ai')) log(`title ${rec.id} (ai) ${rec.title}`); return; }
  if (!rec.title && tl.firstUser) { const t = titleFromPrompt(tl.firstUser); if (t && sm.setTitle(rec.id, t, 'first')) log(`title ${rec.id} (first) ${rec.title}`); }
}
// ---- 보조 작업(서브에이전트) 감시 — 세션마다 SubagentWatcher 하나(읽기 전용, daemon/subagents.mjs, 2026-09-11) ----
// 목록·상태·횟수가 바뀌면 전체 방송(작업목록의 ⁺N 표시용). 기록 본문은 그 보조를 보고 있는(attachSub) 화면에만 보낸다.
const subs = new Map();      // 세션 id → SubagentWatcher
const subsSent = new Map();  // 세션 id → 마지막으로 방송한 version
function subsFor(rec) {
  if (!rec?.recordPath) return null;
  let w = subs.get(rec.id);
  if (!w || w.recordPath !== rec.recordPath) { w = new SubagentWatcher(rec, log); subs.set(rec.id, w); subsSent.delete(rec.id); }
  return w;
}
const subsList = (id) => subs.get(id)?.list() || [];
const allSubs = () => { const o = {}; for (const [id, w] of subs) if (w.subs.size) o[id] = w.list(); return o; };
function pumpSubs(rec, force = false) {
  const w = subsFor(rec); if (!w) return;
  const busy = rec.status === 'busy' || rec.status === 'attention';
  w.scan(busy, force);
  if (!w.subs.size) return;
  const { updates } = w.poll(tails.get(rec.id) || null, busy);
  if (subsSent.get(rec.id) !== w.version) { subsSent.set(rec.id, w.version); broadcast({ type: 'subagents', id: rec.id, list: w.list() }); }
  for (const u of updates) for (const c of clients) if (c.attached === rec.id && c.attachedSub === u.key) send(c, { type: 'subtranscript', id: rec.id, key: u.key, items: u.items });
}
// ---- 배경 작업(v2.80, 2026-10-07 사용자 신고): 배경 명령·감시·코덱스 위임이 남았는데 메인·보조가 쉬면 초록불(완료)이 켜지던 문제 ----
// 기록의 시작("running in background with ID")과 끝(같은 task-id 알림·TaskStop·감시 만료)을 짝지어 남은 것을 센다(transcript.mjs backgroundPending).
// 지금 CLI 프로세스(sm.live) 이전에 시작한 것은 죽은 것으로 본다. 바뀌면 {type:'bg', id, list} 방송 — 화면은 대기여도 '배경 작업 중'(파란 도는 고리).
const bgSent = new Map(); // 세션 id → 마지막으로 방송한 목록 서명
function bgFor(id) {
  const st = sm.live.get(id); const tl = tails.get(id);
  if (!st || !tl || typeof tl.backgroundPending !== 'function') return [];
  return tl.backgroundPending(st.procAt || 0);
}
const allBg = () => { const o = {}; for (const id of tails.keys()) { const l = bgFor(id); if (l.length) o[id] = l; } return o; };
function pumpBg(rec) {
  const list = bgFor(rec.id); const sig = list.map(b => b.id).join(',');
  if ((bgSent.get(rec.id) ?? '') === sig) return;
  bgSent.set(rec.id, sig); broadcast({ type: 'bg', id: rec.id, list });
}
setInterval(() => {
  const now = Date.now();
  for (const rec of sm.list()) {
    const fast = rec.status === 'busy' || rec.status === 'attention' || now < (hotUntil.get(rec.id) || 0);
    const tl = tails.get(rec.id);
    if (!fast && tl && now - (tl.polledAt || 0) < POLL_SLOW_MS) continue;
    // 끝난 대화(P18, 2026-11-18 점검): CLI 가 없으니 기록이 더 자라지 않는다 — 한 번 읽은 뒤에는 화면이 그 대화를 열어 둘 때만 읽는다
    // (끝난 카드가 수십 장 쌓인 PC 에서 1.5초마다 전부 stat·읽던 것). 다시 열리면(sm.live) 평소대로.
    if (!fast && tl && tl.polledAt && !sm.live.has(rec.id) && ![...clients].some((c) => c.attached === rec.id)) continue;
    pumpTail(rec);
    try { pumpSubs(rec); } catch (e) { log(`subs ${rec.id}: ${e.message}`); }
    try { pumpBg(rec); } catch (e) { log(`bg ${rec.id}: ${e.message}`); }
  }
  for (const id of [...tails.keys()]) if (!sm.get(id)) { tails.delete(id); hotUntil.delete(id); subs.delete(id); subsSent.delete(id); bgSent.delete(id); }
}, POLL_FAST_MS);

/** 이전 대화(요청·답만)를 새 에이전트에 넘길 글로 묶는다. 최근 것부터 8천 자 안쪽. */
function buildHandoff(items, rec) {
  const lines = [];
  for (const it of items) {
    if (it.kind === 'user') lines.push(`[사용자]\n${it.text}`);
    else if (it.kind === 'assistant') lines.push(`[이전 어시스턴트]\n${it.text}`);
    else if (it.kind === 'tool') lines.push(`(도구 ${it.name}: ${it.detail || ''})`);
  }
  let body = lines.join('\n\n');
  if (body.length > 8000) body = '…(앞부분 생략)…\n\n' + body.slice(-8000);
  const from = `${({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini' })[rec.agent] || rec.agent} ${rec.modelLabel || rec.model}${rec.effort ? ` · ${rec.effort}` : ''}`;
  return `[이전 대화 이어받기 — ${from} 세션에서 옮겨 옴, 폴더 ${rec.cwd}]\n아래는 지금까지의 대화다. 이미 끝난 작업은 다시 하지 말고, 결정된 내용은 그대로 따른다.\n\n${body || '(이전 대화 없음)'}`;
}

// ---- http ----
const MIME = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const VENDOR = {
  '/vendor/xterm.js': path.join(ROOT, 'node_modules/@xterm/xterm/lib/xterm.js'),
  '/vendor/xterm.css': path.join(ROOT, 'node_modules/@xterm/xterm/css/xterm.css'),
  '/vendor/addon-fit.js': path.join(ROOT, 'node_modules/@xterm/addon-fit/lib/addon-fit.js'),
};
function serveFile(res, file, req = null) {
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  // 영상(튜토리얼 덱 시연, v2.95)은 구간 요청(Range)을 받아야 재생 막대로 건너뛸 수 있다
  const m = path.extname(file) === '.mp4' && /^bytes=(\d*)-(\d*)$/.exec(req?.headers?.range || '');
  if (m) {
    const size = fs.statSync(file).size; let a = m[1] === '' ? size - Number(m[2]) : Number(m[1]); let b = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
    a = Math.max(0, a); b = Math.min(size - 1, b);
    if (!(a <= b)) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, 'Cache-Control': 'no-store' });
    return fs.createReadStream(file, { start: a, end: b }).pipe(res);
  }
  if (path.extname(file) === '.mp4') res.setHeader('Accept-Ranges', 'bytes');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { const s = Buffer.concat(chunks).toString('utf8'); if (!s) return resolve({}); try { resolve(JSON.parse(s)); } catch { reject(new Error('bad json')); } }); req.on('error', reject);
});
// 모듈 라우트 전용 출처 검사(F2) — Origin이 없으면(curl 등 로컬 도구) 통과, 있으면 이 데몬 주소만 허용. Sec-Fetch-Site도 같은 기준으로 본다.
const sameOrigin = (req) => {
  const o = req.headers.origin;
  if (o && o !== `http://127.0.0.1:${PORT}` && o !== `http://localhost:${PORT}`) return false;
  const s = req.headers['sec-fetch-site'];
  if (s && s !== 'same-origin' && s !== 'none') return false;
  return true;
};
// 보안(P18 점검, 2026-11-11): 받는 주소(Host)는 이 데몬 주소만 — 바깥 도메인을 127.0.0.1 로 돌려 대는 우회(DNS 리바인딩)로 파일·상태를 읽지 못하게.
// Host 가 없는 옛 요청(HTTP/1.0 로컬 도구)은 통과(브라우저는 늘 보낸다).
const profileOf = (req) => profiles.who(req.headers['x-iris-profile']);
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
const hostOk = (req) => { const h = String(req.headers.host || '').toLowerCase(); return !h || HOSTS.has(h); };
// 캔버스(P18): 내줄 수 있는 파일(미리보기 + 페이지가 부르는 자원) · 글자로 보여 줄 코드·문서
const CANVAS_SERVE = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.pdf', '.txt', '.md', '.csv', '.woff', '.woff2', '.ttf', '.mp4', '.webm', '.mp3', '.wav']);
const CANVAS_TEXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.css', '.scss', '.html', '.htm', '.json', '.md', '.txt', '.csv', '.tsv', '.xml', '.yml', '.yaml', '.toml', '.ini', '.ps1', '.cmd', '.bat', '.sh', '.sql', '.java', '.c', '.h', '.cpp', '.cs', '.go', '.rs', '.rb', '.php', '.kt', '.swift', '.vue', '.svelte', '.tex', '.r', '.lua']);
// 「누른 곳 고르기」: 격리된 미리보기 안에서만 돈다. 마우스를 올린 요소에 테두리, 누르면 그 글자·위치를 부모(캔버스)에 알리고 이동은 막는다.
const CANVAS_PICKER = `<script>(()=>{let cur=null;const st=document.createElement('style');st.textContent='.__iris_hov{outline:2px dashed #8fa8ff!important;outline-offset:2px!important;cursor:crosshair!important}.__iris_pick{outline:3px solid #ffb547!important;outline-offset:2px!important;background:rgba(255,181,71,.12)!important}';document.head.appendChild(st);
const sel=(e)=>{const a=[];for(let n=e;n&&n.nodeType===1&&a.length<5;n=n.parentElement){let s=n.tagName.toLowerCase();if(n.id)s+='#'+n.id;else if(n.classList.length)s+='.'+[...n.classList].filter(c=>!c.startsWith('__iris')).slice(0,2).join('.');a.unshift(s);}return a.join(' > ');};
addEventListener('mouseover',(e)=>{if(cur)cur.classList.remove('__iris_hov');cur=e.target;cur.classList.add('__iris_hov');},true);
addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();document.querySelectorAll('.__iris_pick').forEach(n=>n.classList.remove('__iris_pick'));e.target.classList.add('__iris_pick');parent.postMessage({type:'iris-pick',text:String(e.target.innerText||e.target.alt||e.target.title||'').trim().replace(/\\s+/g,' ').slice(0,200),selector:sel(e.target)},'*');},true);})();</script>`;
const MODULE_ACTION_RE = new RegExp(`^/api/modules/(${NAME_RE.source.slice(1, -1)})/(remove|restart)$`);
const CATALOG_INSTALL_RE = new RegExp(`^/api/catalog/(${NAME_RE.source.slice(1, -1)})/install$`);

/** zip 버퍼 → 설치(zip 업로드·카탈로그 공용). 거부될 zip 이면 실행 중인 모듈을 건드리지 않고(F6), 실패하면 돌던 모듈을 되살린다. { status, body }. */
async function installFromBuffer(buf, { allow, via }) {
  const pre = inspectZip(buf, { faceVersion: VERSION });
  const name = pre.name && NAME_RE.test(pre.name) ? pre.name : null;
  const wasRunning = !!(name && mods.list().find(m => m.name === name && m.status === 'running'));
  try {
    if (name && pre.errors.length === 0) await mods.stop(name);
    const r = installZip(buf, { modulesDir: MODULES_DIR, faceVersion: VERSION, allowUnofficial: allow });
    log(`module install ${r.name} v${String(r.version).slice(0, 40)} official=${r.official} unofficialAllowed=${allow} via=${via}`);
    mods.scan(); mods.start(r.name);
    return { status: 201, body: r };
  } catch (e) {
    if (wasRunning) { mods.scan(); mods.start(name); }
    if (e.code === 'UNOFFICIAL') { log(`409 module install unofficial: ${String(e.inspect?.name).slice(0, 40)} via=${via}`); return { status: 409, body: { error: 'unofficial', ...e.inspect } }; }
    log(`400 module install: ${String(e.message).slice(0, 200)} via=${via}`); return { status: 400, body: { error: e.message } };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  try {
    // 보안(P18): ① Host 검사 ② 상태를 바꾸는 요청(GET·HEAD 말고 전부)은 같은 출처만 — 예전엔 라우트마다 손으로 넣어
    // 세션 만들기·보내기·설정 저장 등이 빠져 있었다(다른 웹사이트가 「전부 허용」 세션을 만들 수 있었음). 아래 개별 검사는 그대로 둔다(이중 확인).
    if (!hostOk(req)) { log(`403 host: ${String(req.headers.host).slice(0, 80)} ${req.method} ${p}`); return json(res, 403, { error: 'forbidden host' }); }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) { log(`403 origin ${req.method} ${p}: origin=${String(req.headers.origin || '(none)').slice(0, 120)}`); return json(res, 403, { error: 'forbidden origin' }); }
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveFile(res, path.join(APP, 'index.html'));
    if (req.method === 'GET' && p.startsWith('/app/')) return serveFile(res, path.join(APP, path.normalize(p.slice(5)).replace(/^([.][.][\\/])+/, '')), req);
    if (req.method === 'GET' && VENDOR[p]) return serveFile(res, VENDOR[p]);
    if (req.method === 'GET' && p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    // 전부 종료 중(v2.97)에는 새 세션·재개·전송을 받지 않는다 — 정리하는 사이에 새 CLI 가 떠서 남는 일이 없게(종료 요청·조회는 그대로)
    if (shuttingDown && req.method !== 'GET' && p !== '/api/shutdown') return json(res, 503, { error: 'IRIS 가 종료하는 중입니다' });
    if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true, version: VERSION, about: ABOUT, pid: process.pid, uptime: process.uptime(), sessions: sm.list().length, root: WS_ROOT, rootName: rootName(WS_ROOT), features: features(), autoResume: autoResumeState(settings.get()) });
    if (req.method === 'GET' && p === '/api/settings') return json(res, 200, settings.get());
    if (req.method === 'PUT' && p === '/api/settings') { const b = await readBody(req); return json(res, 200, settings.set(b)); }
    if (req.method === 'GET' && p === '/api/agents') return json(res, 200, activeAgentsMap(AGENTS));
    // 잠든 에이전트 목록(2026-09-23 다른 선생님 PC: Codex 버튼이 없어 고장으로 보였다) — /api/agents 모양은 그대로 두고 따로 준다.
    if (req.method === 'GET' && p === '/api/agents/sleeping') return json(res, 200, { sleeping: sleepingAgents() });
    // v2.76: 버튼 옆 안내의 재료 — 에이전트별 계정 수(null = 판단 안 함)·프로그램 없음·잠든 목록.
    if (req.method === 'GET' && p === '/api/agents/status') return json(res, 200, agentStatus());
    if (req.method === 'GET' && p === '/api/limits') return json(res, 200, await readLimits());
    if (req.method === 'GET' && p === '/api/gemini/usage') return json(res, 200, geminiUsage.get());
    if (req.method === 'POST' && p === '/api/gemini/usage/refresh') return json(res, 200, await geminiUsage.refresh());
    if (req.method === 'GET' && p === '/api/usage/local') return json(res, 200, localUsage.get({ force: url.searchParams.get('force') === '1' }));
    if (req.method === 'GET' && p === '/api/usage/share') return json(res, 200, { enabled: !!dashBase, ...shareMeter.info() });
    // 메모리 계기판(v2.78): 최근 30분 기록 · 많이 차지하는 것(펼쳤을 때만, 8초 캐시) · 잔여물 미리보기(종료 안 함, 같은 출처만)
    if (req.method === 'GET' && p === '/api/memory') return json(res, 200, memory.history());
    if (req.method === 'GET' && p === '/api/memory/top') return json(res, 200, await memory.top());
    if (req.method === 'POST' && p === '/api/memory/sweep-preview') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden origin' });
      return json(res, 200, await memory.sweepPreview());
    }
    if (req.method === 'POST' && p === '/api/dash/ensure') { const d = await ensureDash(); log(`dash ensure: ${d.message}`); return json(res, d.alive ? 200 : 503, d); }
    if (req.method === 'POST' && p === '/api/wake') {
      // 잠든 에이전트 수동으로 깨우기(installer Task 17) — 대시보드에서 relay 로그인 뒤 다시 시도할 때도 쓸 수 있는 멱등 경로.
      const b = await readBody(req);
      const agent = String(b.agent || '');
      if (!KNOWN_AGENTS.includes(agent)) return json(res, 400, { error: `알 수 없는 에이전트: ${agent}` });
      const { active } = wake(agent, { log: (m) => log(`wake: ${m}`) });
      broadcast(agentsMsg());
      return json(res, 200, { ok: true, active });
    }
    // ---- 모듈(계약 v1): 목록 · zip 설치 · 제거 · 재시작. 본체는 모듈 이름을 모른다 — 전부 module.json 에서 온다. ----
    if (req.method === 'GET' && p === '/api/modules') return json(res, 200, { list: mods.list(), dir: MODULES_DIR });
    if (req.method === 'POST' && p === '/api/modules/install') {
      if (!sameOrigin(req) || !req.headers['x-file-name']) { log(`403 module install: origin=${String(req.headers.origin || '(none)').slice(0, 120)}`); return json(res, 403, { error: 'forbidden origin' }); }
      const chunks = []; let size = 0;
      const allow = url.searchParams.get('allowUnofficial') === '1';
      try {
        await new Promise((resolve, reject) => { req.on('data', (c) => { size += c.length; if (size > 50 * 1024 * 1024) { req.pause(); const e = new Error('too large (50MB)'); e.code = 'TOO_LARGE'; reject(e); } else chunks.push(c); }); req.on('end', resolve); req.on('error', reject); });
      } catch (e) {
        res.setHeader('Connection', 'close'); json(res, 413, { error: e.message }); setImmediate(() => { try { req.destroy(); } catch {} }); log('413 module install: too large'); return;
      }
      const r = await installFromBuffer(Buffer.concat(chunks), { allow, via: `zip ${size}B` });
      return json(res, r.status, r.body);
    }
    // ---- 카탈로그(v2.53): 공식 IRIS 모듈 목록 + 설치 여부. 「설치」는 그때만 GitHub 릴리스에서 zip 을 받아 같은 설치 길(서명 필수)로. ----
    if (req.method === 'GET' && p === '/api/catalog') return json(res, 200, { list: mergeCatalog(loadCatalog(), mods.list()) });
    const cm = p.match(CATALOG_INSTALL_RE);
    if (cm && req.method === 'POST') {
      if (!sameOrigin(req)) { log(`403 catalog install: origin=${String(req.headers.origin || '(none)').slice(0, 120)}`); return json(res, 403, { error: 'forbidden origin' }); }
      const entry = loadCatalog().find(c => c.name === cm[1]);
      if (!entry) return json(res, 404, { error: `not in catalog: ${cm[1]}` });
      let z;
      try { z = await fetchReleaseZip(entry); log(`catalog fetch ${entry.name} ${z.asset} v${z.version} ${z.buf.length}B`); }
      catch (e) { log(`502 catalog fetch ${entry.name}: ${String(e.message).slice(0, 200)}`); return json(res, 502, { error: `download failed: ${e.message}` }); }
      const r = await installFromBuffer(z.buf, { allow: false, via: `catalog ${z.asset}` });
      return json(res, r.status, r.body);
    }
    // ---- 인수 문서(설치 패키지 v2, Task 21): 상태·카드 읽기 / 「설치 이어하기」 / 「나중에」. POST 는 같은 출처만. ----
    if (req.method === 'GET' && p === '/api/handoff') return json(res, 200, handoff.info());
    // ---- 튜토리얼·온톨로지·도구(v2.90, 설계 = docs\설계-튜토리얼-2026-10-19.md). 쓰는 길은 전부 같은 출처만. ----
    if (req.method === 'GET' && p === '/api/tutorial') return json(res, 200, { ...handoff.info().tutorial, root: WS_ROOT, rootName: path.basename(WS_ROOT), leadAgent: handoff.info().leadAgent, year: new Date().getFullYear(), month: new Date().getMonth() + 1 });
    if (req.method === 'GET' && p === '/api/tutorial/existing') return json(res, 200, listExisting(WS_ROOT)); // v2.95 다시 보기 = 이미 있는 R/D/P(읽기만)
    if (req.method === 'POST' && (p === '/api/tutorial/plan' || p === '/api/tutorial/structure' || p === '/api/tutorial/done' || p === '/api/tutorial/prefs' || p === '/api/ontology/rebuild' || p === '/api/open-folder')) {
      if (!sameOrigin(req)) { log(`403 ${p}: origin=${String(req.headers.origin || '(none)').slice(0, 120)}`); return json(res, 403, { error: 'forbidden origin' }); }
      const b = await readBody(req);
      if (p === '/api/tutorial/plan') return json(res, 200, planStructure(WS_ROOT, b.spec));
      if (p === '/api/tutorial/done') return json(res, 200, handoff.finishTutorial({ skipped: !!b.skipped }));
      if (p === '/api/tutorial/prefs') return json(res, 200, handoff.setTutorialPrefs(b)); // v2.95 성별·보던 쪽
      if (p === '/api/tutorial/structure') {
        let r; try { r = createStructure(WS_ROOT, b.spec, { log }); } catch (e) { log(`tutorial structure 실패: ${e?.message || e}`); return json(res, 500, { ok: false, errors: [{ where: '', message: `폴더를 만들지 못했습니다: ${e?.message || e}` }] }); }
        if (!r.ok) return json(res, 400, r);
        r.ontology = await runOntology(WS_ROOT, { python: ontologyPython(WS_ROOT, pythonExe()), log });
        return json(res, 200, r);
      }
      if (p === '/api/ontology/rebuild') { const o = await runOntology(WS_ROOT, { python: ontologyPython(WS_ROOT, pythonExe()), log }); return json(res, 200, { ontology: o, graph: ontologyGraph(WS_ROOT) }); }
      // 폴더 열기(튜토리얼 「폴더 열기」·온톨로지 노드): 영혼 폴더 안의 **폴더**만, explorer.exe 에 경로 하나만 넘긴다.
      const dir = path.resolve(WS_ROOT, String(b.rel || ''));
      if (!(dir + path.sep).toLowerCase().startsWith((path.resolve(WS_ROOT) + path.sep).toLowerCase()) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return json(res, 404, { error: '영혼 폴더 안의 폴더만 열 수 있습니다' });
      // windowsHide 를 주지 않는다 — explorer.exe 는 받은 SW_HIDE 를 새 폴더 창에 그대로 써서 창이 "열렸지만 안 보이는" 상태가 된다(2026-10-21 실측·사용자 신고, v2.92).
      try { spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref(); log(`open-folder ${dir}`); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (req.method === 'GET' && p === '/api/relay/ready') {
      if (url.searchParams.get('agent') === 'gemini') return json(res, 200, { ready: true, relay: false, agent: 'gemini' }); // Gemini 는 중계기를 거치지 않는다(P18)
      const agent = url.searchParams.get('agent') === 'codex' ? 'codex' : 'claude';
      if (!dashDir()) return json(res, 200, { ready: true, relay: false }); // 중계기 도구가 없는 설치 — 확인할 것이 없다
      return json(res, 200, { ready: await relayReady(agent), relay: true, agent });
    }
    if (req.method === 'GET' && p === '/api/ontology/graph') return json(res, 200, ontologyGraph(WS_ROOT));
    // 판 B: 설치된 도구(출처 base·iris·manual 붙임) + 엄선 목록 상태. 설치·제거는 같은 출처만, 한 번에 하나(엔진 큐).
    if (req.method === 'GET' && p === '/api/tools') return json(res, 200, { ...tools.annotate(listTools(WS_ROOT)), catalog: tools.status() });
    if (req.method === 'POST' && (p === '/api/tools/install' || p === '/api/tools/remove' || p === '/api/tools/cancel')) {
      if (!sameOrigin(req)) { log(`403 tools: origin=${String(req.headers.origin || '(none)').slice(0, 120)}`); return json(res, 403, { error: 'forbidden origin' }); }
      const b = await readBody(req); const id = String(b?.id || '');
      if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) return json(res, 400, { error: 'bad id' });
      const r = p.endsWith('/install') ? await tools.install(id) : p.endsWith('/remove') ? await tools.remove(id) : await tools.cancelRemove(id);
      return json(res, r.ok ? 200 : 409, r);
    }
    // 내 MCP(P18): 미리 보기는 읽기·검사만, 추가는 엔진 큐·잠금 아래에서 다시 검사한 뒤. 빼기·취소는 위 remove/cancel 그대로.
    if (req.method === 'POST' && (p === '/api/tools/custom/preview' || p === '/api/tools/custom/install')) {
      if (!sameOrigin(req)) { log(`403 tools custom: origin=${String(req.headers.origin || '(none)').slice(0, 120)}`); return json(res, 403, { error: 'forbidden origin' }); }
      const b = await readBody(req);
      const input = {};
      if (typeof b?.text === 'string') input.text = b.text.slice(0, 20000);
      if (typeof b?.name === 'string') input.name = b.name.slice(0, 60);
      if (b?.form && typeof b.form === 'object') input.form = Object.fromEntries(['name', 'transport', 'url', 'command', 'args'].map((k) => [k, String(b.form[k] ?? '').slice(0, 2000)]));
      const agents = [...new Set((Array.isArray(b?.agents) ? b.agents : []).filter((a) => a === 'claude' || a === 'codex'))];
      if (p.endsWith('/preview')) return json(res, 200, tools.previewCustom(input, agents));
      const r = await tools.installCustom(input, agents);
      return json(res, r.ok ? 200 : 409, r);
    }
    if (req.method === 'POST' && (p === '/api/handoff/resume' || p === '/api/handoff/dismiss')) {
      if (!sameOrigin(req)) { log(`403 handoff ${p}: origin=${String(req.headers.origin || '(none)').slice(0, 120)}`); return json(res, 403, { error: 'forbidden origin' }); }
      if (p === '/api/handoff/dismiss') { handoff.dismiss(); return json(res, 200, { ok: true, ...handoff.info() }); }
      const r = handoff.resume();
      return json(res, r.ok ? 200 : 400, r);
    }
    // ---- 인증(v2.84): 열쇠 만료 상태·다시 확인·갱신. 쓰기는 같은 출처만. ----
    if (req.method === 'GET' && p === '/api/auth') { if (auth.available && !auth.info) await auth.refresh(); return json(res, 200, auth.public()); }
    if (p.startsWith('/api/auth/') && req.method === 'POST') {
      if (!sameOrigin(req)) { log(`403 auth ${p}: origin=${String(req.headers.origin || '(none)').slice(0, 120)}`); return json(res, 403, { error: 'forbidden origin' }); }
      if (p === '/api/auth/refresh') { await auth.refresh(); return json(res, 200, auth.public()); }
      if (p === '/api/auth/renew') { const b = await readBody(req); const r = await auth.renew(String(b.id || '')); return json(res, r.ok ? 200 : 400, { ...r, auth: auth.public() }); }
    }
    // ---- 업데이트(v2.58): 확인·설정·내려받기·적용. 전부 같은 출처만(화면에서만 부른다). ----
    if (req.method === 'GET' && p === '/api/update') return json(res, 200, updater.info());
    if (p.startsWith('/api/update/') && req.method === 'POST') {
      if (!sameOrigin(req)) { log(`403 update ${p}: origin=${String(req.headers.origin || '(none)').slice(0, 120)}`); return json(res, 403, { error: 'forbidden origin' }); }
      if (p === '/api/update/check') { try { return json(res, 200, await updater.check()); } catch (e) { log(`502 update check: ${String(e.message).slice(0, 200)}`); return json(res, 502, { error: e.message }); } }
      if (p === '/api/update/settings') { const b = await readBody(req); return json(res, 200, updater.setEnabled(b.enabled !== false)); }
      if (p === '/api/update/apply') { const r = await updater.apply(); return json(res, r.ok ? 200 : 400, { ...r, info: updater.info() }); }
      // 비밀 금고(v2.62): 보관된 복구 문구를 엔진의 화면 창으로만 보여 준다. 문구는 데몬·응답·로그를 거치지 않는다(STA PowerShell 5.1 필요).
      if (p === '/api/vault/reveal') {
        if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden origin' });
        const script = path.join(WS_ROOT, '_agent', 'setup', 'secrets-vault.ps1');
        if (!fs.existsSync(script)) return json(res, 404, { error: 'secrets-vault.ps1 없음(세팅 전이거나 가이드 v13 이전)' });
        const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const r = await new Promise((resolve) => {
          const child = spawn(ps, ['-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'ShowRecovery', '-SoulRoot', WS_ROOT], { env: applyReceiptEnv({ ...process.env }), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
          let err = ''; child.stderr.on('data', (d) => { err += d.toString('utf8'); if (err.length > 4000) err = err.slice(-2000); });
          child.on('close', (code) => resolve({ code, err })); child.on('error', (e) => resolve({ code: -1, err: e.message }));
        });
        log(`vault reveal exit=${r.code}`);
        return json(res, r.code === 0 ? 200 : 400, r.code === 0 ? { ok: true } : { error: (r.err.split(/\r?\n/).find((l) => /복구문구|봉투|STA|error/i.test(l)) || r.err.trim().split(/\r?\n/).pop() || `exit ${r.code}`).slice(0, 300) });
      }
      if (p === '/api/update/apply-now') {
        const r = updater.applyNow();
        if (!r.ok) return json(res, 400, r);
        json(res, 200, r); log('update apply-now: shutting down for the updater'); setTimeout(shutdown, 300); return;   // ⏻ 와 같은 경로 — 적용기가 폴더를 바꾸고 다시 띄운다
      }
    }
    const mm = p.match(MODULE_ACTION_RE);
    if (mm && req.method === 'POST') {
      if (!sameOrigin(req)) { log(`403 module ${mm[2]}: origin=${String(req.headers.origin || '(none)').slice(0, 120)}`); return json(res, 403, { error: 'forbidden origin' }); }
      const [, name, act] = mm;
      await mods.stop(name);
      if (act === 'remove') { removeModule(MODULES_DIR, name); log(`module remove ${name}`); mods.scan(); }
      else { mods.scan(); mods.start(name); log(`module restart ${name}`); }
      return json(res, 200, { ok: true, list: mods.list() });
    }
    if (req.method === 'GET' && p === '/api/sessions') return json(res, 200, listFor(profileOf(req)));
    // ---- 개인 공간(P18) ----
    if (req.method === 'GET' && p === '/api/profiles') return json(res, 200, { list: profiles.list(), me: profileOf(req) });
    if (req.method === 'POST' && p.startsWith('/api/profiles/')) {
      const b = await readBody(req); const act = p.slice('/api/profiles/'.length);
      try {
        if (act === 'create') { const r = profiles.create(b.name, b.pin); log(`profile create ${r.id}`); return json(res, 201, r); }
        if (act === 'unlock') { const r = profiles.unlock(String(b.id || ''), b.pin); log(`profile unlock ${r.id}`); return json(res, 200, r); }
        if (act === 'lock') { profiles.lock(req.headers['x-iris-profile']); return json(res, 200, { ok: true }); }
        if (act === 'remove') { profiles.remove(String(b.id || ''), b.pin); log(`profile remove ${b.id}`); return json(res, 200, { ok: true }); }
        return json(res, 404, { error: 'no such action' });
      } catch (e) { log(`profile ${act} refused: ${e.message}`); return json(res, e.code === 'WAIT' ? 429 : 400, { error: e.message }); }
    }
    // 잠긴 공간의 세션은 그 공간 열쇠가 없으면 기록·보내기·전환·이름 바꾸기 등 어떤 하위 길도 열지 않는다
    { const mo = p.match(/^\/api\/sessions\/([a-z0-9]+)(?:\/|$)/); if (mo && !canSee(sm.get(mo[1]), profileOf(req))) return json(res, 403, { error: '잠긴 개인 공간의 세션입니다' }); }
    if (req.method === 'POST' && p === '/api/sessions') {
      const body = await readBody(req);
      const rec = sm.create(body);
      const owner = profileOf(req); if (owner) { const r0 = sm.get(rec.id); if (r0) { r0.owner = owner; rec.owner = owner; sm.save(); broadcastSessions(); } } // 잠금을 푼 공간에서 만든 세션 = 그 공간 것
      recent.touch(rec.cwd);
      log(`create ${rec.id} pid=${rec.pid} ${rec.cmdline} cwd=${rec.cwd}`);
      return json(res, 201, { ...rec });
    }
    if (req.method === 'GET' && p === '/api/folders') {
      const f = listFolders(); const fresh = await checkFresh();
      const live = {}; for (const s of sm.list()) (live[s.cwd.toLowerCase()] ||= []).push({ id: s.id, agent: s.agent, status: s.status });
      return json(res, 200, { ...f, recent: recent.get(), fresh, live });
    }
    if (req.method === 'POST' && p === '/api/upload') {
      // 사진·파일 첨부: state/uploads/<시각>-<이름> 에 저장하고 절대경로를 돌려준다(요청문에 경로로 삽입). 30일 지나면 sweepUploads 가 지운다.
      const name = decodeURIComponent(req.headers['x-file-name'] || 'file.bin').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
      const dir = path.join(STATE, 'uploads'); fs.mkdirSync(dir, { recursive: true });
      // 이름 = <시각(밀리초까지)>-<이름>, 그래도 겹치면 -2, -3 …(P18 점검: 같은 초에 같은 이름을 두 번 올리면 앞 파일이 덮였다)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
      let file = path.join(dir, `${stamp}-${name}`);
      for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${stamp}-${n}-${name}`);
      const chunks = []; let size = 0;
      await new Promise((resolve, reject) => { req.on('data', (c) => { size += c.length; if (size > 50 * 1024 * 1024) { reject(new Error('too large (50MB)')); req.destroy(); } else chunks.push(c); }); req.on('end', resolve); req.on('error', reject); });
      fs.writeFileSync(file, Buffer.concat(chunks)); log(`upload ${path.basename(file)} ${size}B`);
      return json(res, 201, { path: file, size });
    }
    if (req.method === 'GET' && p === '/api/voice/status') return json(res, 200, voice.status());
    if (req.method === 'POST' && p === '/api/transcribe') {
      // 🎤 음성 전사: 본문 = 오디오(webm/wav…), 헤더 x-audio-ext · x-folder-hint(현재 폴더 이름, 용어 힌트에 덧붙임) · x-retry-file(실패한 녹음 재시도)
      const retry = req.headers['x-retry-file'] ? decodeURIComponent(req.headers['x-retry-file']) : '';
      let file;
      if (retry) { if (path.dirname(path.resolve(retry)) !== path.resolve(voice.dir)) return json(res, 403, { error: '재시도는 state\\voice 안의 파일만' }); file = retry; }
      else {
        const chunks = []; let size = 0;
        await new Promise((resolve, reject) => { req.on('data', (c) => { size += c.length; if (size > 100 * 1024 * 1024) { reject(new Error('too large (100MB)')); req.destroy(); } else chunks.push(c); }); req.on('end', resolve); req.on('error', reject); });
        if (!size) return json(res, 400, { error: '오디오가 비어 있습니다' });
        file = voice.saveAudio(Buffer.concat(chunks), req.headers['x-audio-ext'] || 'webm');
      }
      const folderHint = req.headers['x-folder-hint'] ? decodeURIComponent(req.headers['x-folder-hint']) : '';
      try { const out = await voice.transcribe(file, { folderHint }); log(`transcribe ${path.basename(file)} ${out.audioSecs ?? '?'}s → ${out.text.length}c in ${out.wall}s (${out.device})`); return json(res, 200, out); }
      catch (e) { log(`502 transcribe ${path.basename(file)}: ${e.message}`); return json(res, 502, { error: e.message, file, status: voice.status() }); }
    }
    if (req.method === 'GET' && p === '/api/file') {
      // 대화 안 삽입용 로컬 파일(이미지·HTML·PDF 등). 이 PC 로컬 데몬 전용 — 시스템 폴더는 막는다.
      const raw = url.searchParams.get('path') || ''; const file = path.resolve(raw.replace(/^\/([A-Za-z]:)/, '$1'));
      const ext = path.extname(file).toLowerCase();
      const okExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.html', '.htm', '.pdf', '.txt', '.md', '.csv', '.json'];
      if (!okExt.includes(ext) || /^[A-Za-z]:\\(windows|program files|program files \(x86\)|programdata)\\/i.test(file)) { log(`403 file ${file}`); return json(res, 403, { error: `열 수 없는 파일 종류이거나 시스템 폴더입니다: ${file}` }); }
      // 열쇠·비밀 자리는 내주지 않는다(P18 — 1년 로그인 열쇠 secrets\iris-cli-token.json 등)
      if (/[\\/]secrets[\\/]/i.test(file) || /^\.env/i.test(path.basename(file))) { log(`403 file secret ${file}`); return json(res, 403, { error: `비밀 보관 자리의 파일은 열 수 없습니다: ${path.basename(file)}` }); }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { log(`404 file ${file}`); return json(res, 404, { error: `파일이 없습니다: ${file}` }); }
      // HTML·SVG 미리보기는 격리(P18): 스크립트는 돌되 이 데몬과 다른 출처(null)로 — 대화에 나온 학생 과제 HTML 같은 것이
      // IRIS 의 같은 출처 권한으로 세션을 만들거나 파일을 읽지 못하게. iframe 의 allow-same-origin 이 있어도 이 헤더가 이긴다.
      if (['.html', '.htm', '.svg'].includes(ext)) res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-popups allow-forms allow-modals');
      return serveFile(res, file);
    }
    // ---- 캔버스(P18): 경로형 파일 주소 · 바뀜 확인 · 코드 글자 ----
    // /api/fs/<절대 경로> — 페이지 안의 상대 주소(style.css·img/a.png)가 그대로 풀리도록 경로 모양으로 내준다. 지키는 것은 /api/file 과 같다
    // (GET 만·Host 검사·시스템 폴더·secrets·.env 거절, HTML·SVG 는 격리). ?pick=1 이면 HTML 끝에 「누른 곳 고르기」 작은 스크립트를 붙인다
    // (격리된 다른 출처라 IRIS 에는 손댈 수 없고, 고른 글자만 postMessage 로 캔버스에 알린다).
    if (req.method === 'GET' && (p.startsWith('/api/fs/') || p === '/api/file/stat' || p === '/api/file/text')) {
      const raw = p.startsWith('/api/fs/') ? decodeURIComponent(p.slice('/api/fs/'.length)) : (url.searchParams.get('path') || '');
      const file = path.resolve(raw.replace(/^\/([A-Za-z]:)/, '$1'));
      const ext = path.extname(file).toLowerCase();
      if (/^[A-Za-z]:\\(windows|program files|program files \(x86\)|programdata)\\/i.test(file) || /[\\/]secrets[\\/]/i.test(file) || /^\.env/i.test(path.basename(file))) { log(`403 canvas ${file}`); return json(res, 403, { error: `열 수 없는 자리입니다: ${path.basename(file)}` }); }
      let st = null; try { st = fs.statSync(file); } catch {}
      if (p === '/api/file/stat') return json(res, 200, st && st.isFile() ? { exists: true, mtime: st.mtimeMs, size: st.size } : { exists: false });
      if (!st || !st.isFile()) return json(res, 404, { error: `파일이 없습니다: ${path.basename(file)}` });
      if (p === '/api/file/text') {
        if (!CANVAS_TEXT.has(ext)) return json(res, 415, { error: '글자로 볼 수 없는 파일입니다' });
        const LIMIT = 400 * 1024; const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(Math.min(st.size, LIMIT)); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
        return json(res, 200, { text: buf.toString('utf8'), truncated: st.size > LIMIT, size: st.size, mtime: st.mtimeMs });
      }
      if (!CANVAS_SERVE.has(ext)) return json(res, 415, { error: '캔버스에서 내줄 수 없는 파일 종류입니다' });
      if (['.html', '.htm', '.svg'].includes(ext)) res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-popups allow-forms allow-modals');
      if ((ext === '.html' || ext === '.htm') && url.searchParams.get('pick') === '1') {
        const html = fs.readFileSync(file, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(/<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${CANVAS_PICKER}</body>`) : html + CANVAS_PICKER);
      }
      return serveFile(res, file, req);
    }
    if (req.method === 'GET' && p === '/api/doc') {
      // 문서(한/글·워드·엑셀·PPT)를 PDF로 변환해 삽입용으로 서빙. 원본은 읽기 전용, 결과는 state/doc-cache 캐시.
      // ?pages=1 = 변환하고 쪽 그림을 준비해 { ok, id, n, sizes } (캔버스가 다 된 뒤에 화면을 갈아 끼우려고). 미리보기 칸(iframe)에서 실패하면 JSON 글자 대신 안내 화면(P18 2026-11-24).
      const raw = url.searchParams.get('path') || ''; const file = path.resolve(raw.replace(/^\/([A-Za-z]:)/, '$1'));
      const fail = (code, msg) => {
        log(`${code} doc ${file}: ${msg}`);
        if (!/^(iframe|document|frame)$/.test(String(req.headers['sec-fetch-dest'] || ''))) return json(res, code, { error: msg });
        const h = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
        return res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>미리보기 안내</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4ef;color:#2b2a27;font:15px/1.7 "Malgun Gothic",sans-serif}main{max-width:30em;padding:24px;text-align:center}b{display:block;margin-bottom:6px;word-break:break-all}</style><main><b>${h(path.basename(file))}</b>${h(msg)}</main></html>`);
      };
      if (/^[A-Za-z]:\\(windows|program files|program files \(x86\)|programdata)\\/i.test(file)) return fail(403, '시스템 폴더의 파일은 열 수 없어요.');
      if (!isConvertible(file)) return fail(403, '미리보기로 바꿀 수 없는 문서 형식이에요.');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(404, '이 자리에 파일이 없어요. 옮겼거나 이름이 바뀌었을 수 있어요.');
      try {
        const pdf = await toPdf(file, path.join(STATE, 'doc-cache'), log);
        if (url.searchParams.get('pages') === '1') { // 쪽 그림 보기(docview.js). 그릴 수 없는 PC 면 pages 없이 → 화면이 PDF 로 보여 준다
          try { return json(res, 200, { ok: true, ...(await openPages(pdf, log)) }); } catch (e) { log(`docpages ${e.message}`); return json(res, 200, { ok: true }); }
        }
        return serveFile(res, pdf);
      } catch (e) { return fail(502, e.message); }
    }
    if (req.method === 'GET' && (p === '/api/doc/page' || p === '/api/doc/hashes')) {
      const id = url.searchParams.get('id') || ''; if (!ID_RE.test(id)) return json(res, 400, { error: 'id' });
      if (p === '/api/doc/hashes') { const hashes = await pageHashes(id); return hashes ? json(res, 200, { hashes }) : json(res, 404, { error: 'no pages' }); }
      const n = Number(url.searchParams.get('n')); if (!Number.isInteger(n) || n < 1 || n > 5000) return json(res, 400, { error: 'n' });
      const f = await pageFile(id, n); if (!f) return json(res, 404, { error: 'no page' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400, immutable' }); // id 는 내용 지문이라 바뀌지 않는다
      return fs.createReadStream(f).pipe(res);
    }
    // 캔버스: 도구 글에 나온 문서 이름(transcript.mjs docMentions) → 실제 파일. 절대 경로 → 작업 폴더 기준 → 작업 폴더 아래에서 같은 이름(깊이 4·폴더 400개까지, 가장 최근 것).
    if (req.method === 'GET' && p === '/api/canvas/find') {
      const cwd = path.resolve(url.searchParams.get('cwd') || ''); const names = url.searchParams.getAll('name').slice(0, 40);
      if (!/^[A-Za-z]:\\/.test(String(url.searchParams.get('cwd') || ''))) return json(res, 400, { error: '작업 폴더가 없습니다' });
      const blocked = (f) => /^[A-Za-z]:\\(windows|program files|program files \(x86\)|programdata)\\/i.test(f) || /[\\/]secrets[\\/]/i.test(f) || /^\.env/i.test(path.basename(f));
      const stat = (f) => { if (blocked(f) || !(isConvertible(f) || /\.pdf$/i.test(f))) return null; try { const st = fs.statSync(f); return st.isFile() ? { path: f, mtime: st.mtimeMs } : null; } catch { return null; } };
      let index = null; // 같은 이름 찾기용 — 필요할 때만 한 번 훑는다
      const byName = (n) => {
        if (!index) {
          index = new Map(); const queue = [[cwd, 0]]; let dirs = 0;
          while (queue.length && dirs < 400) {
            const [dir, d] = queue.shift(); dirs++;
            let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
            for (const e of ents) {
              if (e.isDirectory()) { if (d < 4 && !/^(node_modules|\.git|\.venv|venv|__pycache__|secrets|doc-cache|_build)$/i.test(e.name)) queue.push([path.join(dir, e.name), d + 1]); }
              else if (e.isFile() && (isConvertible(e.name) || /\.pdf$/i.test(e.name)) && !e.name.startsWith('~$')) { const k = e.name.toLowerCase(); index.set(k, [...(index.get(k) || []), path.join(dir, e.name)]); }
            }
          }
        }
        return (index.get(n.toLowerCase()) || []).map(stat).filter(Boolean).sort((x, y) => y.mtime - x.mtime)[0] || null;
      };
      const out = new Map();
      for (const n of names) {
        const w = n.replace(/^file:\/\/\//i, '').replace(/^\/([A-Za-z])\//, '$1:\\').replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\');
        const hit = /^[A-Za-z]:\\/.test(w) ? stat(path.resolve(w)) : stat(path.resolve(cwd, w)) || byName(path.basename(w));
        if (hit && !out.has(hit.path.toLowerCase())) out.set(hit.path.toLowerCase(), { name: n, ...hit });
      }
      return json(res, 200, { files: [...out.values()] });
    }
    if (req.method === 'POST' && p === '/api/open') {
      // 원본 파일을 이 PC의 기본 앱(한/글·워드·엑셀 …)으로 연다. 브라우저가 못 여는 문서의 ⧉ 전용.
      // explorer.exe 에 경로 하나만 넘긴다(cmd.exe /c start 는 인용부호 재해석으로 한글·공백 경로가 깨질 수 있음).
      const b = await readBody(req); const file = path.resolve(String(b.path || '').replace(/^\/([A-Za-z]:)/, '$1'));
      if (!/^[A-Za-z]:\\/.test(file) || /^[A-Za-z]:\\(windows|program files|program files \(x86\)|programdata)\\/i.test(file)) { log(`403 open ${file}`); return json(res, 403, { error: `시스템 폴더는 열 수 없습니다: ${file}` }); }
      if (/\.(exe|bat|cmd|com|ps1|vbs|js|msi|scr|lnk)$/i.test(file)) { log(`403 open exec ${file}`); return json(res, 403, { error: `실행 파일은 열지 않습니다: ${file}` }); }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { log(`404 open ${file}`); return json(res, 404, { error: `파일이 없습니다: ${file}` }); }
      try { spawn('explorer.exe', [file], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); log(`open ${file}`); return json(res, 200, { ok: true }); }
      catch (e) { log(`500 open ${file}: ${e.message}`); return json(res, 500, { error: e.message }); }
    }
    if (req.method === 'GET' && p === '/api/transcript-preview') {
      const file = url.searchParams.get('path'); const agent = url.searchParams.get('agent') || 'claude';
      if (!file || !fs.existsSync(file)) return json(res, 404, { error: 'file not found' });
      const tl = new TranscriptTail(file, agent); tl.poll();
      return json(res, 200, { items: tl.items, meta: tailMeta(tl) });
    }
    // 보조 작업(서브에이전트): 목록 / 한 보조의 전체 기록(2026-09-11)
    const ms = p.match(/^\/api\/sessions\/([a-z0-9]+)\/subagents(?:\/([^/]+)\/transcript)?$/);
    if (ms && req.method === 'GET') {
      const rec = sm.get(ms[1]); if (!rec) return json(res, 404, { error: 'no session' });
      const w = subsFor(rec); if (w) { try { pumpSubs(rec, true); } catch {} }
      if (!ms[2]) return json(res, 200, { list: w?.list() || [], running: w?.running() || 0 });
      const tr = w?.transcript(decodeURIComponent(ms[2])); if (!tr) return json(res, 404, { error: 'no subagent' });
      return json(res, 200, tr);
    }
    // 세션 이름 바꾸기(v2.85): 사이드바·머리 제목 두 번 클릭. 빈 글 = 자동 이름으로 되돌림. 같은 출처만(화면에서만 부른다).
    const mt = p.match(/^\/api\/sessions\/([a-z0-9]+)\/title$/);
    if (mt && req.method === 'POST') {
      if (!sameOrigin(req)) { log(`403 title ${mt[1]}: origin=${String(req.headers.origin || '(none)').slice(0, 120)}`); return json(res, 403, { error: 'forbidden origin' }); }
      const b = await readBody(req); const rec = sm.renameByUser(mt[1], b.title);
      if (!rec) return json(res, 404, { error: 'no session' });
      log(`title ${rec.id} (${rec.titleSource || 'auto'}) ${rec.title}`);
      return json(res, 200, { ok: true, title: rec.title, titleSource: rec.titleSource });
    }
    // 작업목록 고정(P18 2026-11-19): { pinned: true|false }. 같은 출처 검사는 요청 맨 앞(GET 아닌 것 전부), 개인 공간 검사는 위 /api/sessions/:id 공통 줄이 한다.
    const mpin = p.match(/^\/api\/sessions\/([a-z0-9]+)\/pin$/);
    if (mpin && req.method === 'POST') {
      const b = await readBody(req); const rec = sm.setPinned(mpin[1], !!b.pinned);
      if (!rec) return json(res, 404, { error: 'no session' });
      log(`pin ${rec.id} ${rec.pinned ? 'on' : 'off'}`);
      return json(res, 200, { ok: true, pinned: !!rec.pinned });
    }
    const m = p.match(/^\/api\/sessions\/([a-z0-9]+)(?:\/(input|resize|buffer|forget|transcript|send|switch|resume))?$/);
    if (m) {
      const [, id, action] = m;
      if (!sm.get(id)) return json(res, 404, { error: 'no session' });
      if (req.method === 'GET' && !action) return json(res, 200, { ...sm.get(id) });
      if (req.method === 'GET' && action === 'transcript') { const tl = pumpTail(sm.get(id)); return json(res, 200, tl ? { items: tl.items, meta: tailMeta(tl) } : { items: [], meta: null, pending: true }); }
      if (req.method === 'GET' && action === 'buffer') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(sm.buffer(id)); }
      if (req.method === 'POST' && action === 'send') { const b = await readBody(req); const text = String(b.text || '').trim(); if (!text) return json(res, 400, { error: 'empty' });
        // 끝난 대화에 보내면(P18, 2026-11-18): 영어 "session not live" 대신 「↻ 여기서 재개」와 같은 길로 다시 열며 이 글을 첫 요청으로 넘긴다.
        if (!sm.live.has(id)) {
          const rec0 = sm.get(id);
          if (!rec0) return json(res, 404, { error: '이 대화를 찾지 못했습니다. 목록을 새로 고쳐 주세요.' });
          if (!rec0.sessionId) return json(res, 409, { error: '이 대화는 끝났고, 첫 메시지 전에 끝나서 이어 열 수 없어요. 새 대화로 보내 주세요(왼쪽 위 「+」).' });
          try { const r2 = sm.resume(id, { prompt: text }); hotUntil.set(id, Date.now() + HOT_AFTER_SEND_MS); log(`send→resume ${id} ${text.length}c pid=${r2.pid}`); broadcastSessions(); return json(res, 200, { ok: true, resumed: true }); }
          catch (e) { log(`send→resume ${id} failed: ${e.message}`); return json(res, 409, { error: `끝난 대화를 다시 열지 못했어요: ${e.message}` }); }
        }
        sm.send(id, text); hotUntil.set(id, Date.now() + HOT_AFTER_SEND_MS); log(`send ${id} ${text.length}c status=${sm.get(id)?.status}`); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && action === 'input') { const b = await readBody(req); sm.write(id, String(b.data ?? '')); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && action === 'resize') { const b = await readBody(req); sm.resize(id, Number(b.cols), Number(b.rows)); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && action === 'switch') {
        const b = await readBody(req); const before = sm.get(id); const beforeCmd = before.cmdline;
        let rec;
        if (b.agent && b.agent !== before.agent) {
          // 다른 에이전트로: 이전 대화를 글로 묶어 새 CLI의 첫 요청으로 넘긴다(맥락 이어받기)
          const tl = tailFor(before); try { tl?.poll(); } catch {}
          const handoff = buildHandoff(tl?.items || [], before);
          const first = handoff + (b.text ? `\n\n[이어지는 요청]\n${b.text}` : '\n\n위 대화를 이어받았으면 한 줄로 확인만 하고, 다음 요청을 기다려라.');
          rec = sm.replaceAgent(id, { agent: b.agent, model: b.model, expectModel: b.expectModel, effort: b.effort, readOnly: b.readOnly, permission: b.permission, approval: b.approval, sandbox: b.sandbox, mode: b.mode, prompt: first });
          tails.delete(id);
          log(`handoff ${id} [${beforeCmd}] -> [${rec.cmdline}] pid=${rec.pid} items=${(tl?.items || []).length} chars=${first.length}`);
        } else {
          rec = sm.switchTo(id, { model: b.model, expectModel: b.expectModel, effort: b.effort, readOnly: b.readOnly, permission: b.permission, approval: b.approval, sandbox: b.sandbox, mode: b.mode, prompt: b.text || '' });
          log(`switch ${id} [${beforeCmd}] -> [${rec.cmdline}] pid=${rec.pid}`);
        }
        broadcastSessions();
        return json(res, 200, { ...rec });
      }
      // 죽은 카드 그 자리에서 재개(화면 "여기서 재개" 버튼, 2026-09-11 v2.42). 살아 있는 세션이면 400.
      if (req.method === 'POST' && action === 'resume') { const b = await readBody(req); const rec = sm.resume(id, { prompt: String(b.text || '') }); log(`resume ${id} pid=${rec.pid} [${rec.cmdline}]`); broadcastSessions(); return json(res, 200, { ...rec }); }
      if (req.method === 'POST' && action === 'forget') { sm.forget(id); log(`forget ${id}`); return json(res, 200, { ok: true }); }
      if (req.method === 'DELETE' && !action) { const rec = sm.close(id); log(`close ${id} pid=${rec.pid}`); return json(res, 200, { ok: true }); }
    }
    // 전부 종료(v2.97): ?wait=1 이면 세션·MCP 정리와 확인이 끝난 뒤 보고를 돌려주고 내려간다(창 ×·⏻·트레이가 이 길).
    // wait 없이 부르면 옛날처럼 접수만 바로 답한다(버전 불일치 재시작 등 내부 호출 호환). 두 번 불러도 정리는 한 번만 돈다.
    if (req.method === 'POST' && p === '/api/shutdown') {
      if (url.searchParams.get('wait') === '1') { const report = await shutdown(); return json(res, 200, { ok: report.ok, report }); }
      json(res, 200, { ok: true, closing: sm.list().length }); setTimeout(shutdown, 100); return;
    }
    log(`404 ${req.method} ${p}${url.search}`);
    json(res, 404, { error: `not found: ${req.method} ${p}` });
  } catch (e) { log(`400 ${req.method} ${p}: ${e.message}`); json(res, 400, { error: e.message }); }
});

// ---- websocket ----
// 보안(P18): 실시간 통로도 같은 출처·같은 Host 만 — 예전엔 아무 웹사이트나 연결해 세션에 글자(input)를 칠 수 있었다.
// Origin 이 없는 연결(검사 스크립트 등 브라우저가 아닌 로컬 도구)은 HTTP 쪽과 같은 기준으로 통과.
const wss = new WebSocketServer({ server, path: '/ws', verifyClient: ({ req }) => {
  const ok = hostOk(req) && sameOrigin(req);
  if (!ok) log(`403 ws: host=${String(req.headers.host).slice(0, 80)} origin=${String(req.headers.origin || '(none)').slice(0, 120)}`);
  return ok;
} });
wss.on('connection', (ws) => {
  clients.add(ws); ws.attached = null; ws.attachedSub = null;
  // 적용기가 남긴 결과는 첫 화면에 한 번만 실어 보낸다(v2.58) — 새로고침마다 같은 토스트가 다시 뜨지 않게.
  send(ws, { type: 'hello', version: VERSION, sessions: publicList(), subs: allSubs(), bg: allBg(), modules: uiModules(), update: updater.info(), updateResult, setup: setupProgress.info(), handoff: handoff.info(), mem: memory.latest(), auth: auth.public() });
  if (updateResult) updateResult = null;
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
    try {
      if (msg.type === 'profile') {
        ws.profile = profiles.who(msg.token);
        if (ws.attached && !canSee(sm.get(ws.attached), ws.profile)) { ws.attached = null; ws.attachedSub = null; } // 잠갔으면 보던 남의 세션에서 떨어진다
        send(ws, { type: 'sessions', list: listFor(ws.profile) }); return;
      }
      if ((msg.type === 'attach' || msg.type === 'attachSub' || msg.type === 'input' || msg.type === 'resize') && msg.id && !canSee(sm.get(msg.id), ws.profile)) { send(ws, { type: 'error', id: msg.id, error: '잠긴 개인 공간의 세션입니다' }); return; }
      if (msg.type === 'attach') { ws.attached = msg.id; ws.attachedSub = null; send(ws, { type: 'replay', id: msg.id, data: sm.buffer(msg.id), session: sm.get(msg.id) || null }); const rec = sm.get(msg.id); if (rec) { try { pumpSubs(rec, true); } catch {} send(ws, { type: 'subagents', id: msg.id, list: subsList(msg.id) }); } }
      else if (msg.type === 'detach') { ws.attached = null; ws.attachedSub = null; }
      // 보조 작업 서랍: 이 보조(key)의 기록을 실시간으로 받는다. key 없음 = 서랍 닫음. 첫 응답은 전체 기록(reset).
      else if (msg.type === 'attachSub') {
        ws.attachedSub = msg.key || null; if (!ws.attachedSub) return;
        const rec = sm.get(msg.id); const w = rec && subsFor(rec); const tr = w?.transcript(msg.key);
        send(ws, { type: 'subtranscript', id: msg.id, key: msg.key, reset: true, items: tr?.items || [], meta: tr?.meta || null, missing: !tr });
      }
      else if (msg.type === 'input') sm.write(msg.id, String(msg.data ?? ''));
      else if (msg.type === 'resize') sm.resize(msg.id, Number(msg.cols), Number(msg.rows));
    } catch (e) { send(ws, { type: 'error', id: msg.id, error: e.message }); }
  });
  ws.on('close', () => clients.delete(ws));
});

// ---- single instance / pid / shutdown ----
// 전부 종료는 이 함수 하나(v2.97): 창 ×·Alt+F4·⏻·트레이·업데이트 적용·버전 불일치 재시작이 모두 여기로 온다. 여러 번 불려도 같은 약속(Promise)을 돌려준다.
// 순서 = 모듈 shutdown(최대 2.5초) → 세션 가계도 종료·확인(sm.endAll, 최대 20초) → 음성·감시·측정기 → 보고 파일 → 데몬 종료.
// 보고는 응답과 state\shutdown-report.json 두 곳에 남는다 — 창이 결과를 못 받더라도 무엇이 남았는지 나중에 알 수 있게.
const SHUTDOWN_SESSIONS_MS = 20_000;
let shuttingDown = null;
function shutdown() {
  if (shuttingDown) return shuttingDown;
  log('shutdown: start (all sessions by PID tree)');
  try { broadcast({ type: 'shutdown', phase: 'start' }); } catch {}
  shuttingDown = (async () => {
    await Promise.race([mods.stopAll(), new Promise(r => setTimeout(r, 2500))]).catch(() => {});
    let report = null;
    try { report = await Promise.race([sm.endAll(), new Promise(r => setTimeout(() => r(null), SHUTDOWN_SESSIONS_MS))]); }
    catch (e) { log(`shutdown: endAll error ${e?.stack || e}`); }
    if (!report) report = { ok: false, verified: false, timeout: true, sessions: [], ended: 0, survivors: [] };
    try { voice.stop(); } catch {} try { sleepWatcher.stop(); } catch {} try { updater.stop(); } catch {} try { memory.stop(); } catch {}
    try { fs.writeFileSync(path.join(STATE, 'shutdown-report.json'), JSON.stringify({ ...report, at: new Date().toISOString(), version: VERSION }, null, 2), 'utf8'); } catch {}
    try { fs.unlinkSync(PID_FILE); } catch {}
    log(`daemon exit (shutdown ok=${report.ok} verified=${report.verified} survivors=${report.survivors.length}${report.timeout ? ' TIMEOUT' : ''})`);
    return report;
  })();
  shuttingDown.then(() => setTimeout(() => process.exit(0), 400)); // 기다리던 요청에 보고가 나갈 틈
  return shuttingDown;
}
server.on('error', (e) => { if (e.code === 'EADDRINUSE') { console.error(`[iris-face] port ${PORT} in use — daemon already running`); process.exit(2); } console.error(e); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => { fs.writeFileSync(PID_FILE, String(process.pid), 'utf8'); log(`daemon start v${VERSION} pid=${process.pid} sessions=${sm.list().length}`); console.log(`[iris-face] daemon v${VERSION} http://127.0.0.1:${PORT}/ pid=${process.pid}`); log(`features: dashboard=${DASH_AVAILABLE ? dashBase : 'off'} python=${voice.py || 'off'}`); voice.sweep();
  // 메모리 계기판(v2.78): 포트를 잡은 뒤에만 측정기(typeperf)를 띄운다 — 두 번째 실행이 포트 충돌로 끝날 때 고아 측정기를 남기지 않게.
  try { auth.start(); log(`auth: ${auth.available ? 'on' : 'off (tool not installed)'}`); } catch (e) { log(`auth init error: ${e?.message || e}`); }
  try { memory.start(); log(`memory: commit=${memory.features().commit} sweep=${memory.features().sweep ? 'on' : 'off'}`); } catch (e) { log(`memory init error: ${e?.message || e}`); }
  try { mods.scan(); mods.startAll(); log(`modules: ${mods.list().length} in ${MODULES_DIR}`); } catch (e) { log(`modules error: ${e?.message || e}`); }
  // 데몬과 함께 죽은 세션 자동 재개(v2.42): 살아 있던 카드를 같은 자리에서 --resume. 사용자가 닫은 세션은 기록에 없으므로 되살아나지 않는다.
  try { const ar = autoResumeState(settings.get()); const ids = sm.resumeLost({ enabled: ar.enabled }); if (!ar.enabled) log(`auto-resume: off (${ar.source}), ${sm.lost().length} lost session(s) left for manual resume`); else if (ids.length) log(`auto-resume: ${ids.length} lost session(s) → ${ids.join(', ')}`); } catch (e) { log(`auto-resume error: ${e?.message || e}`); } try { Promise.resolve(voice.preload()).catch((e) => log(`voice: preload skipped ${e.message}`)); } catch (e) { log(`voice: preload skipped ${e.message}`); }
  // 업데이트(v2.58): 적용기가 남긴 결과를 한 번 집어 두고(화면 토스트), 다 쓴 내려받기 폴더를 치운 뒤 하루 1회 확인을 건다.
  try { updateResult = updater.consumeResult(); updater.sweep(); const on = updater.start(); log(`update: mode=${updater.mode} daily=${on && updater.enabled ? 'on' : 'off'}`); } catch (e) { log(`update init error: ${e?.message || e}`); }
  // 첨부 보관 정리: 30일 지난 첨부를 시작할 때와 하루 한 번 지운다(daemon/uploads.mjs).
  const sweepUp = () => { try { const r = sweepUploads(path.join(STATE, 'uploads')); if (r.removed) log(`uploads: removed ${r.removed} file(s) older than ${UPLOAD_KEEP_DAYS} days (${Math.round(r.bytes / 1024)}KB), kept ${r.kept}`); } catch (e) { log(`uploads sweep error: ${e?.message || e}`); } };
  sweepUp(); setInterval(sweepUp, 24 * 60 * 60 * 1000).unref();
  // 도구(판 B): 중간에 끊긴 설치·제거를 실제 상태와 맞추고(같은 잠금 아래), 세션이 0 일 때 「제거 대기」를 처리한다(1분마다 확인 — 세션이 있으면 아무것도 안 함).
  tools.reconcile().then((r) => { if (r?.changed) log('tools: reconciled ledger'); }).catch((e) => log(`tools reconcile error: ${e?.message || e}`));
  setInterval(() => { tools.processPending().catch((e) => log(`tools pending error: ${e?.message || e}`)); }, 60 * 1000).unref();
  // 세팅 마무리 자동 실행(v2.60): 가이드가 pending-finalize 를 남기면 창이 대신 마무리한다.
  try { const on = finalizer.start(); log(`finalize: watcher ${on ? 'on' : 'off'} root=${WS_ROOT}`); } catch (e) { log(`finalize init error: ${e?.message || e}`); }
  try { setupProgress.start(); } catch (e) { log(`setup progress init error: ${e?.message || e}`); }
  // 인수 문서 첫 실행 분기(Task 21) — 잃은 세션 자동 재개가 끝난 뒤 한 번만. 인수 문서가 없으면(1.x·손 설치) 조용히 아무 일도 하지 않는다.
  try { const r = handoff.runOnce(); if (r.state !== 'none') log(`handoff: first run state=${r.state} action=${r.action}${r.reason ? ` (${r.reason})` : ''}`); }
  catch (e) { log(`handoff init error: ${e?.stack || e}`); } });
// 데몬이 죽으면 ConPTY 세션도 죽으므로 예외로는 절대 죽지 않게 한다(기록만).
process.on('uncaughtException', (e) => { log(`uncaughtException: ${e?.stack || e}`); });
process.on('unhandledRejection', (e) => { log(`unhandledRejection: ${e?.stack || e}`); });
process.on('SIGINT', () => { try { memory.stop(); } catch {} Promise.race([mods.stopAll(), new Promise(r => setTimeout(r, 2500))]).catch(() => {}).then(() => { try { fs.unlinkSync(PID_FILE); } catch {} log('daemon interrupted (sessions left as-is)'); process.exit(0); }); });
