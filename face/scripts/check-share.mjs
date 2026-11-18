// 공유 계정 「내 몫」 검사(P18) — ShareMeter 규칙(가짜 대시보드 응답). 실제 대시보드·데몬 접촉 0.   npm run verify:share
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ShareMeter } from '../daemon/share.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`PASS ${n}`); } else { fail++; console.log(`FAIL ${n}`); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-share-'));
let t = Date.parse('2026-11-12T10:00:00Z'), status = null;
const iso = (ms) => new Date(ms).toISOString();
const st = ({ w, h, reset = '2026-11-17T00:00:00Z', acc = 'kim@school', active = [], recent = [] }) => ({ currentAccounts: { anthropic: acc }, accounts: [{ name: acc, quota: { unified7d: w, unified5h: h, unified7dReset: reset } }], activity: { active, recent } });
const m = new ShareMeter({ file: path.join(dir, 'share.json'), now: () => t, fetchStatus: async () => status });
const step = async (s, mins = 1) => { t += mins * 60000; status = s; return (await m.sample()).anthropic; };

let a = await step(st({ w: 0.10, h: 0.05 }));
ok(a.mineWeek === 0 && a.accountWeek === 0.10, '처음 = 기준만 잡음');
a = await step(st({ w: 0.14, h: 0.09, active: [{ provider: 'anthropic' }] }));
ok(near(a.mineWeek, 0.04) && near(a.mine5h, 0.04), '이 PC 가 요청 중일 때 늘어난 만큼 = 내 몫');
a = await step(st({ w: 0.20, h: 0.15 }));
ok(near(a.mineWeek, 0.04), '이 PC 가 쉬는 동안 늘어난 것(다른 선생님) = 내 몫 아님');
a = await step(st({ w: 0.23, h: 0.18, recent: [{ provider: 'anthropic', endedAt: iso(t + 30000) }] })); // 지난 측정 30초 뒤에 끝난 요청
ok(near(a.mineWeek, 0.07), '그 사이 끝난 요청이 있어도 내 몫');
a = await step(st({ w: 0.25, h: 0.20, recent: [{ provider: 'codex', endedAt: iso(t) }] }));
ok(near(a.mineWeek, 0.07), '다른 공급자(코덱스) 요청은 클로드 몫에 안 셈');
a = await step(st({ w: 0.25, h: 0.03 }));
ok(near(a.mine5h, 0.03), '5시간 사용률이 줄면 내 5시간 몫도 그 아래로');
a = await step(st({ w: 0.02, h: 0.02, reset: '2026-11-24T00:00:00Z', active: [{ provider: 'anthropic' }] }));
ok(a.mineWeek === 0, '새 주(초기화 시각 바뀜) = 0 부터');
a = await step(st({ w: 0.05, h: 0.04, acc: 'other@school', active: [{ provider: 'anthropic' }] }));
ok(a.mineWeek === 0 && a.account === 'other@school', '계정이 바뀌면 다시 시작');
const m2 = new ShareMeter({ file: path.join(dir, 'share.json'), now: () => t, fetchStatus: async () => null });
ok(m2.info().anthropic?.account === 'other@school', '데몬을 다시 켜도 이어짐(파일)');
ok((await m2.sample()).anthropic.account === 'other@school', '대시보드가 꺼져 있으면 그대로');
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
