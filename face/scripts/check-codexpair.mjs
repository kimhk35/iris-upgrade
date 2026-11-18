// 검사: 코덱스 기록 짝짓기(P18, 2026-11-18 점검 — 같은 폴더에서 거의 동시에 연 코덱스 대화 둘이 기록을 바꿔 잡던 경합).
// 순수 함수 pickCodexRollout 만 본다(실 CLI·데몬 접촉 0). npm run verify:codexpair
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickCodexRollout, CODEX_PAIR_WAIT_MS } from '../daemon/sessions.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };

const T = 1_700_000_000_000;
const A = { id: 's1', rolloutWatchAt: T };
const B = { id: 's2', rolloutWatchAt: T + 400 };
const fA = { file: 'C:/x/rollout-a.jsonl', id: 'aaaa', at: T + 900 };
const fB = { file: 'C:/x/rollout-b.jsonl', id: 'bbbb', at: T + 1300 };

ok(pickCodexRollout({ candidates: [], me: A, peers: [A] }) === null, '후보 없음 = 기다림');
ok(pickCodexRollout({ candidates: [fA], me: A, peers: [A] }) === fA, '혼자 + 후보 하나 = 바로 잡음');
ok(pickCodexRollout({ candidates: [fB, fA], me: A, peers: [A] }) === fA, '혼자 + 후보 여럿 = 가장 먼저 생긴 것');

// 둘이 거의 동시에 — 둘 다 후보가 생겼을 때: 시작 순서 ↔ 생긴 순서
ok(pickCodexRollout({ candidates: [fB, fA], me: A, peers: [A, B], now: T + 2000 }) === fA, '먼저 연 대화 = 먼저 생긴 기록');
ok(pickCodexRollout({ candidates: [fB, fA], me: B, peers: [A, B], now: T + 2000 }) === fB, '나중에 연 대화 = 나중에 생긴 기록');
// 후보가 하나만 먼저 생겼을 때: 옛 코드는 처음 본 대화가 그것을 가져갔다(B 가 A 의 기록을 잡을 수 있었음) — 이제 기다린다
ok(pickCodexRollout({ candidates: [fA], me: B, peers: [A, B], now: T + 2000 }) === null, '기록이 하나뿐이면 둘 다 섣불리 잡지 않음(B)');
ok(pickCodexRollout({ candidates: [fA], me: A, peers: [A, B], now: T + 2000 }) === null, '기록이 하나뿐이면 둘 다 섣불리 잡지 않음(A)');
// 한쪽이 끝내 기록을 못 만들면 30초 뒤에는 있는 것으로
ok(pickCodexRollout({ candidates: [fA], me: A, peers: [A, B], now: T + CODEX_PAIR_WAIT_MS + 1 }) === fA, '30초 지나면 있는 후보 안에서 자리를 정함(A)');
// 이미 잡힌 기록은 호출하는 쪽이 후보에서 뺀다 — A 가 fA 를 잡은 뒤 B 의 차례: 후보 = fB, 짝 없는 대화 = B 하나
ok(pickCodexRollout({ candidates: [fB], me: B, peers: [B], now: T + 2500 }) === fB, 'A 가 잡은 뒤 B 는 남은 기록');

// 데몬 연결(정적): 매 차례 잡힌 목록을 새로 만들고, 짝 없는 같은 폴더 코덱스 대화를 peers 로 넘긴다
const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'daemon', 'sessions.mjs'), 'utf8');
const body = src.slice(src.indexOf('  watchCodexRollout(id, rec) {'), src.indexOf('export function pickCodexRollout'));
ok(/const tick = \(\) => \{[\s\S]*const claimed = new Set/.test(body), '잡힌 기록 목록은 매 차례 새로(tick 안)');
ok(/pickCodexRollout\(\{ candidates, me: rec, peers \}\)/.test(body) && /!r\.recordPath && this\.live\.has\(r\.id\)/.test(body), '짝 없는 살아 있는 같은 폴더 코덱스 대화 = peers');

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
