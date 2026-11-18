// 이 PC 사용량 검사(P18 조각 B) — 가짜 클로드·코덱스 기록으로 세는 규칙 확인 + (있으면) 이 PC 실제 기록을 읽기만 해서 숫자가 나오는지.
//   npm run verify:usage
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeFile, LocalUsage, dayKey } from '../daemon/usage.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`PASS ${n}`); } else { fail++; console.log(`FAIL ${n}`); } };
const now = Date.now(), iso = (ms) => new Date(ms).toISOString(), today = dayKey(now), yday = dayKey(now - 86400000);

const claude = [
  { type: 'user', timestamp: iso(now), message: { role: 'user', content: '활동지 만들어 줘' } },
  { type: 'assistant', timestamp: iso(now), message: { id: 'm1', usage: { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 9000, output_tokens: 20 } } },
  { type: 'assistant', timestamp: iso(now), message: { id: 'm1', usage: { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 9000, output_tokens: 20 } } }, // 같은 응답의 둘째 줄
  { type: 'user', timestamp: iso(now), message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },          // 도구 결과 = 요청 아님
  { type: 'user', timestamp: iso(now), isMeta: true, message: { role: 'user', content: 'Stop hook feedback' } },              // 시스템 글 = 요청 아님
  { type: 'user', timestamp: iso(now), message: { role: 'user', content: '<command-name>/clear</command-name>' } },             // 명령 = 요청 아님
  { type: 'user', timestamp: iso(now - 86400000), message: { role: 'user', content: [{ type: 'text', text: '어제 요청' }] } },
].map((j) => JSON.stringify(j) + '\n').join(''); // 실제 기록처럼 줄마다 줄바꿈으로 끝남
const c = summarizeFile(claude, 'claude');
ok(c[today]?.requests === 1, `클로드 오늘 요청 1번(도구 결과·시스템 글·명령 제외) (${c[today]?.requests})`);
ok(c[today]?.tokens === 170, `클로드 토큰 = 들어감+캐시 만들기+나옴, 같은 응답은 한 번, 캐시 읽기 제외 (${c[today]?.tokens})`);
ok(c[yday]?.requests === 1, '어제 요청은 어제 칸에');

const codex = [
  { type: 'event_msg', timestamp: iso(now), payload: { type: 'user_message', message: '요약해 줘' } },
  { type: 'event_msg', timestamp: iso(now), payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 } } } },
  { type: 'event_msg', timestamp: iso(now), payload: { type: 'token_count', info: null } },
  { type: 'response_item', timestamp: iso(now), payload: { type: 'message', role: 'user', content: [] } },
].map((j) => JSON.stringify(j) + '\n').join('');
const x = summarizeFile(codex, 'codex');
ok(x[today]?.requests === 1 && x[today]?.tokens === 250, `코덱스 요청 1번 · 토큰 = (1000−800)+50 (${x[today]?.requests}/${x[today]?.tokens})`);
ok(Object.keys(summarizeFile('깨진 줄\n{"type":', 'claude')).length === 0, '깨진 줄은 건너뜀');

// 폴더 훑기 · 8일 넘은 파일 제외 · 다시 읽기 캐시
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-usage-'));
const cd = path.join(tmp, 'claude', 'projects', 'C--x'); fs.mkdirSync(cd, { recursive: true });
const xd = path.join(tmp, 'codex', 'sessions', '2026', '11', '12'); fs.mkdirSync(xd, { recursive: true });
fs.writeFileSync(path.join(cd, 'a.jsonl'), claude); fs.writeFileSync(path.join(xd, 'rollout-1.jsonl'), codex);
const old = path.join(cd, 'old.jsonl'); fs.writeFileSync(old, claude); const t9 = (now - 9 * 86400000) / 1000; fs.utimesSync(old, t9, t9);
const lu = new LocalUsage({ claudeDir: path.join(tmp, 'claude'), codexHome: path.join(tmp, 'codex') });
const u = lu.get({ force: true });
ok(u.today.requests === 2 && u.today.tokens === 420, `합계 = 클로드+코덱스, 9일 전 파일 제외 (${u.today.requests}/${u.today.tokens})`);
ok(u.week.requests === 3 && u.days.length === 7, '이번 주(7일) = 어제 포함 3번');
const more = JSON.stringify({ type: 'user', timestamp: iso(now), message: { role: 'user', content: '하나 더' } });
fs.appendFileSync(path.join(cd, 'a.jsonl'), more.slice(0, 20)); // 쓰는 중인 반쪽 줄
ok(lu.get({ force: true }).today.requests === 2, '쓰는 중인 반쪽 줄은 아직 세지 않음');
fs.appendFileSync(path.join(cd, 'a.jsonl'), more.slice(20) + '\n');
ok(lu.get({ force: true }).today.requests === 3, '다 써지면 늘어난 부분만 읽어 셈');
fs.rmSync(tmp, { recursive: true, force: true });

// 이 PC 실제 기록(읽기만) — 있으면 숫자가 나오는지만
const realC = process.env.CLAUDE_CONFIG_DIR, realX = process.env.CODEX_HOME;
if (realC || realX) {
  const t0 = Date.now(); const r = new LocalUsage({ claudeDir: realC, codexHome: realX }).get({ force: true });
  ok(Number.isFinite(r.today.requests) && r.days.length === 7, `이 PC 실제 기록: 오늘 ${r.today.requests}번 · 7일 ${r.week.requests}번 · 파일 ${r.files}개 · ${Date.now() - t0}ms`);
}
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
