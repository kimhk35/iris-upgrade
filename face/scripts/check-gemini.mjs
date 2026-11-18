// 검사: 세 번째 AI = Gemini(Antigravity CLI · agy) 연결(P18, 2026-11-19).
// 1~6절은 가짜 자료만(실 agy·데몬 접촉 0). 7절(--live)만 진짜 agy 로 시험 데몬(3459, 임시 state·임시 폴더)에서 대화 하나를 끝까지 돌린다.
//   npm run verify:gemini            (가짜만)
//   npm run verify:gemini -- --live  (진짜 agy, 구독 사용 — 짧은 질문 2개)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGENTS, normalize, buildCommand, keepResumeModel, permLabel } from '../daemon/agents.mjs';
import { agyModelsFrom, ModelCatalog } from '../daemon/models.mjs';
import { TranscriptTail, geminiArgs, writtenFiles } from '../daemon/transcript.mjs';
import { findGeminiRecords, geminiUserText } from '../daemon/sessions.mjs';
import { trustGemini, preTrust } from '../daemon/trust.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-gemini-'));

// 1) AI 정의·명령
ok(AGENTS.gemini && AGENTS.gemini.efforts.length === 0, '1 Gemini 정의 · 깊이 칸 없음(모델 이름에 들어 있음)');
const s1 = normalize({ agent: 'gemini', model: 'gemini-3.8-flash-low', mode: 'bypass' });
ok(s1.agent === 'gemini' && s1.modelActual === 'gemini-3.8-flash-low' && s1.effort === '' && s1.mode === 'bypass', '1 normalize: 실제 모델 = 고른 이름 그대로, 깊이 없음, 실행 방식 유지');
const c1 = buildCommand(s1, tmp);
ok(c1.agent === 'gemini' && c1.cmdline === 'agy --model gemini-3.8-flash-low --dangerously-skip-permissions' && c1.args[0] === '/c', '1 명령: agy --model … --dangerously-skip-permissions (cmd /c)');
ok(buildCommand(normalize({ agent: 'gemini', model: 'gemini-4-argon-high', mode: 'plan' }), tmp, { resumeId: 'abc' }).cmdline === 'agy --model gemini-4-argon-high --mode plan --conversation abc', '1 재개: --conversation <번호> · 계획만 = --mode plan');
ok(normalize({ agent: 'gemini', model: 'gemini-4-argon-high', mode: 'nope' }).mode === '', '1 모르는 실행 방식은 버림(매번 묻기)');
ok(permLabel(s1) === '전부 허용', '1 권한 표시 = 전부 허용');
const kept = keepResumeModel(normalize({ agent: 'gemini' }), { agent: 'gemini', model: 'old', modelActual: 'gemini-3.1-old-high', modelLabel: 'Gemini 3.1 (High)' });
ok(kept.modelActual === 'gemini-3.1-old-high', '1 재개는 쓰던 정확한 모델 그대로(목록에서 빠져도)');

// 2) 모델 목록 = agy models (이름 = 실제 모델)
const list = agyModelsFrom('Fetching available models...\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\nclaude-opus-5-5-high\tClaude Opus 5.5 (High)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n잡음 줄\n');
ok(list.length === 3 && list[1].id === 'claude-opus-5-5-high' && list[1].actual === 'claude-opus-5-5-high' && list[2].label === 'GPT-OSS 120B (Medium)', '2 agy models 해석: 3줄 · 실제 이름 = id · Claude·GPT-OSS 포함(사용자 결정)');
{
  const A = { claude: { models: [{ id: 'opus', label: 'Opus' }], default: { model: 'opus' } }, codex: { models: [{ id: 'g', label: 'g' }], default: { model: 'g' } }, gemini: { models: [{ id: 'x', label: 'x' }], default: { model: 'x' } } };
  let changed = 0;
  const cat = new ModelCatalog({ AGENTS: A, codexHome: tmp, cacheFile: path.join(tmp, 'scan.json'), agyExe: 'agy.exe', agyRun: async () => 'gemini-9-new-high\tGemini 9 (High)\n', resolve: () => ({ file: null, chain: [] }) });
  cat.refreshGemini({ onChange: () => changed++ });
  await new Promise((r) => setTimeout(r, 50));
  ok(A.gemini.models[0]?.id === 'gemini-9-new-high' && A.gemini.default.model === 'gemini-9-new-high' && changed === 1, '2 뒤에서 받은 목록으로 갈아 끼움 · 화면에 알림');
  ok(fs.existsSync(path.join(tmp, 'gemini-models.json')), '2 받은 목록을 저장(다음 시작에 바로 씀)');
  const A2 = JSON.parse(JSON.stringify(A)); A2.gemini.models = [{ id: 'x', label: 'x' }];
  new ModelCatalog({ AGENTS: A2, codexHome: tmp, cacheFile: path.join(tmp, 'scan.json'), agyExe: null });
  ok(A2.gemini.models[0].id === 'gemini-9-new-high', '2 다음 시작: 저장된 목록을 곧바로 씀');
  let ran = 0;
  const cat3 = new ModelCatalog({ AGENTS: A2, codexHome: tmp, cacheFile: path.join(tmp, 'scan.json'), agyExe: 'agy.exe', agyRun: async () => { ran++; return ''; } });
  cat3.refreshGemini(); cat3.refreshGemini(); await new Promise((r) => setTimeout(r, 30));
  ok(ran === 1 && A2.gemini.models[0].id === 'gemini-9-new-high', '2 10분 안에는 다시 안 물음 · 빈 답(로그인 전)이면 목록 유지');
}

// 3) 기록 → 화면 항목
const rec = path.join(tmp, 'brain', '11111111-1111-4111-8111-111111111111', '.system_generated', 'logs');
fs.mkdirSync(rec, { recursive: true });
const L = (o) => JSON.stringify(o) + '\n';
fs.writeFileSync(path.join(rec, 'transcript.jsonl'),
  L({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-19T01:00:00Z', content: '<USER_REQUEST>\n표 만들어 줘\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is…\n</ADDITIONAL_METADATA>' }) +
  L({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-19T01:00:01Z', model: 'gemini-4-argon-medium', input_tokens: 900, cache_read_tokens: 100, output_tokens: 20, tool_calls: [{ name: 'write_file', args: { Path: '"C:\\\\work\\\\표.md"', Content: '"| a |"' } }] }) +
  L({ step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: '2026-11-19T01:00:02Z', content: 'Created At: x\nCompleted At: y\nCreated file.' }) +
  L({ step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-19T01:00:03Z', model: 'gemini-4-argon-medium', output_tokens: 5, tool_calls: [{ name: 'run_command', args: { CommandLine: '"dir"', toolSummary: '"List"' } }] }) +
  L({ step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-19T01:00:04Z', model: 'gemini-4-argon-medium', content: '표를 만들었어요.' }));
const tl = new TranscriptTail(path.join(rec, 'transcript.jsonl'), 'gemini');
const items = tl.poll();
ok(items.map((i) => i.kind).join(',') === 'user,tool,tool_result,tool,assistant', `3 항목 순서 = 요청·도구·결과·도구·답 (${items.map((i) => i.kind).join(',')})`);
ok(items[0].text === '표 만들어 줘', '3 요청 = <USER_REQUEST> 안만(agy 가 붙인 시각·설정 안내 뺌)');
ok(items[1].name === 'write_file' && items[1].files?.[0] === 'C:\\work\\표.md', '3 파일 쓰기 → 캔버스 파일 목록(두 번 싸인 인수 풀기)');
ok(items[2].text === 'Created file.', '3 도구 결과 = 머리 시각 줄 뺀 본문');
ok(items[3].detail === 'dir', '3 명령 = CommandLine 값');
ok(tl.model === 'gemini-4-argon-medium' && items[4].text === '표를 만들었어요.', '3 실제 응답 모델 이름을 읽음(이름 = 실제 모델 대조용)');
ok(tl.lastUsage?.in === 1000 && tl.unknown === 0, '3 토큰 사용량 · 모르는 줄 0');
ok(geminiArgs({ CommandLine: '"a b"' }).command === 'a b' && writtenFiles('replace_file_content', { path: 'x.md' })[0] === 'x.md', '3 인수 이름 맞추기·편집 도구도 파일 목록');

// 4) 기록 짝짓기 — 폴더 판정(목록 파일 · history.jsonl)
{
  const home = path.join(tmp, 'agy');
  const mk = (id, first, ageMs = 0) => {
    const d = path.join(home, 'brain', id, '.system_generated', 'logs'); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'transcript.jsonl'), L({ step_index: 0, type: 'USER_INPUT', created_at: new Date(Date.now() - ageMs).toISOString(), content: `<USER_REQUEST>\n${first}\n</USER_REQUEST>` }));
  };
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  mk(A, '첫 요청 A'); mk(B, '첫 요청 B');
  const wsA = path.join(tmp, 'work-A'), wsB = path.join(tmp, 'work-B');
  fs.mkdirSync(path.join(home, 'cache'), { recursive: true });
  fs.writeFileSync(path.join(home, 'cache', 'conversation_metadata.json'), JSON.stringify({ conversations: { [A]: { summary: { WorkspaceURIs: [`file:///${wsA.replace(/\\/g, '/')}`] } } } }));
  fs.writeFileSync(path.join(home, 'history.jsonl'), L({ display: '첫 요청 B', timestamp: Date.now(), workspace: wsB }));
  ok(findGeminiRecords({ home, since: Date.now() - 5000, cwd: wsA }).map((c) => c.id).join() === A, '4 목록 파일의 폴더로 짝');
  ok(findGeminiRecords({ home, since: Date.now() - 5000, cwd: wsB }).map((c) => c.id).join() === B, '4 목록에 아직 없으면 history.jsonl(같은 글·±10초)의 폴더로 짝');
  ok(findGeminiRecords({ home, since: Date.now() + 60_000, cwd: wsA }).length === 0, '4 세션 시작 전 기록은 후보가 아님');
  ok(geminiUserText('<USER_REQUEST>\n안녕\n</USER_REQUEST>') === '안녕', '4 요청 글 꺼내기');
}

// 5) 폴더 신뢰 미리 적기(처음 폴더 물음 중 보낸 첫 요청이 사라지던 것)
{
  const home = path.join(tmp, 'agy-trust');
  const ws = path.join(tmp, 'trust-me');
  ok(trustGemini(ws, home) === 'created', '5 설정 없으면 만들기');
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ theme: 'dark', trustedWorkspaces: [ws.toUpperCase()] }));
  ok(trustGemini(ws, home) === 'unchanged', '5 대소문자만 다른 같은 폴더는 그대로');
  ok(trustGemini(path.join(tmp, 'other'), home) === 'appended', '5 새 폴더는 덧붙임');
  const j = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
  ok(j.theme === 'dark' && j.trustedWorkspaces.length === 2, '5 다른 설정 키는 그대로');
  ok(preTrust({ agent: 'gemini', cwd: ws, fallback: { agyHome: home } }).result === 'unchanged', '5 세션 띄우기 직전 경로(preTrust)');
}

// 6) 화면·데몬 연결(정적)
{
  const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const html = src('app/index.html'), main = src('app/main.js'), sess = src('daemon/sessions.mjs'), srv = src('daemon/server.mjs');
  ok(/data-agent="gemini"/.test(html), '6 Gemini 단추');
  ok(/se\.hidden = !efforts\.length/.test(main) && /mode: sel\.agent === 'gemini' \? \(st\.geminiMode \?\? 'bypass'\)/.test(main), '6 깊이 칸 숨김 · 기본 = 전부 허용');
  ok(/agent === 'gemini' \? null/.test(main), '6 공유 계정 몫 계산에서 Gemini 제외(중계기 밖)');
  ok(/if \(agent === 'gemini'\) return this\.watchGeminiRecord/.test(sess) && (/\[\\u2801-\\u28FF\]/.test(sess) || sess.includes('[⠁-⣿]')), '6 기록 짝짓기 · 점자 스피너(Generating...)= 작업 중');
  ok(/searchParams\.get\('agent'\) === 'gemini'\) return json\(res, 200, \{ ready: true/.test(srv), '6 중계기 준비 확인은 Gemini 면 바로 통과');
}

// 7) (--live) 진짜 agy 로 시험 데몬에서 대화 하나
if (process.argv.includes('--live')) {
  const PORT = 3459;
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-gemini-live-'));
  const mods = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-gemini-mods-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-gemini-work-'));
  const d = spawn(process.execPath, [path.join(ROOT, 'daemon', 'server.mjs')], { cwd: ROOT, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, IRIS_FACE_PORT: String(PORT), IRIS_FACE_STATE: state, IRIS_FACE_MODULES: mods, IRIS_FACE_AUTO_RESUME: '0', IRIS_FACE_UPDATE_CHECK: '0' } });
  const req = (method, p, body) => new Promise((res) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { Origin: `http://127.0.0.1:${PORT}`, 'content-type': 'application/json' } }, (x) => {
      let b = ''; x.on('data', (c) => { b += c; }); x.on('end', () => { try { res({ status: x.statusCode, body: JSON.parse(b) }); } catch { res({ status: x.statusCode, body: b }); } });
    });
    r.on('error', () => res({ status: 0, body: null })); if (body) r.write(JSON.stringify(body)); r.end();
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let sid = null;
  try {
    let up = false; for (let i = 0; i < 80 && !up; i++) { await sleep(250); up = (await req('GET', '/api/health')).status === 200; }
    ok(up, '7 시험 데몬(3459)');
    const ag = await req('GET', '/api/agents');
    ok(!!ag.body?.gemini && ag.body.gemini.models.length > 0, `7 /api/agents 에 Gemini (${ag.body?.gemini?.models?.length}개 모델)`);
    let ag2 = ag; for (let i = 0; i < 30 && (ag2.body?.gemini?.models?.length || 0) <= 3; i++) { await sleep(1000); ag2 = await req('GET', '/api/agents'); }
    ok(ag2.body?.gemini?.models?.some((m) => /^claude-/.test(m.id)) && ag2.body.gemini.models.length > 3, `7 시작하자마자 agy models 목록으로 바뀜 (${ag2.body?.gemini?.models?.length}개, Claude·GPT-OSS 포함)`);
    const made = await req('POST', '/api/sessions', { cwd: work, agent: 'gemini', model: 'gemini-3.8-flash-low', mode: 'bypass', prompt: '이 폴더에 iris.txt 를 만들고 내용은 ok 한 줄. 끝나면 완료라고만 답해.' });
    sid = made.body?.id;
    ok((made.status === 200 || made.status === 201) && sid && /^agy --model gemini-3\.8-flash-low --dangerously-skip-permissions$/.test(made.body.cmdline), `7 세션 만들기 (${made.body?.cmdline || made.body?.error})`);
    let s = null;
    for (let i = 0; i < 120; i++) { await sleep(1000); s = (await req('GET', '/api/sessions')).body?.find?.((x) => x.id === sid); if (s?.recordPath && s.status === 'idle') break; }
    ok(!!s?.recordPath && /brain[\\/][0-9a-f-]{36}[\\/]/.test(s.recordPath), `7 기록 파일 짝 (${s?.recordPath ? path.basename(path.dirname(path.dirname(path.dirname(s.recordPath)))) : '없음'})`);
    ok(s?.status === 'idle', `7 끝나면 대기(초록) (${s?.status})`);
    ok(fs.existsSync(path.join(work, 'iris.txt')), '7 첫 요청이 실제로 전달돼 파일이 생김(폴더 신뢰 물음에 먹히지 않음)');
    const tlLive = s?.recordPath ? new TranscriptTail(s.recordPath, 'gemini') : null; const it = tlLive ? tlLive.poll() : [];
    ok(it.some((x) => x.kind === 'tool' && x.files?.some((f) => /iris\.txt$/.test(f))) && it.some((x) => x.kind === 'assistant'), '7 화면 항목: 파일 쓰기(캔버스) + 답');
    ok(tlLive?.model === 'gemini-3.8-flash-low', `7 실제 응답 모델 = 고른 모델 (${tlLive?.model})`);
    const sent = await req('POST', `/api/sessions/${sid}/send`, { text: '방금 만든 파일 이름만 답해.' });
    ok(sent.status === 200, '7 같은 대화에 이어 보내기');
    const more = [];
    for (let i = 0; i < 60; i++) { await sleep(1000); more.push(...tlLive.poll()); if (more.some((x) => x.kind === 'assistant')) break; }
    ok(more.some((x) => x.kind === 'user') && more.some((x) => x.kind === 'assistant' && /iris/i.test(x.text)), '7 두 번째 요청·답이 같은 기록에');
  } finally {
    if (sid) await req('POST', '/api/shutdown?wait=1');
    await sleep(1500);
    try { d.kill(); } catch {}
    await sleep(500);
    for (const p of [state, mods]) try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
    console.log(`(시험 폴더 ${work} — 확인 뒤 지워도 됨)`);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
