// 검사: Gemini 사용량 읽기(P18, 2026-11-19). 1~3절은 견본 화면·가짜 터미널만(실 agy 접촉 0).
//   npm run verify:geminiusage            (가짜만)
//   npm run verify:geminiusage -- --live  (진짜 agy 로 /usage 한 번 — 질문을 보내지 않으므로 사용량을 쓰지 않음, 임시 state)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUsage, parseDuration, cleanScreen, GeminiUsage } from '../daemon/geminiusage.mjs';
import { agyExe, AGY_HOME } from '../daemon/agents.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-gemini-usage-'));

// 1) 견본 화면(agy 1.5.12 실측, 이메일만 가림) 해석
const now = 1_800_000_000_000;
const sample = fs.readFileSync(path.join(HERE, 'fixtures', 'agy-usage-1.5.12.txt'), 'utf8');
const u = parseUsage(sample, now);
ok(!!u, '1 견본 해석됨');
ok(u?.account === 'someone@example.com', `1 계정 (${u?.account})`);
const g = u?.groups.find((x) => x.key === 'gemini'), o = u?.groups.find((x) => x.key === 'other'), x = u?.groups.find((y) => y.key === 'extra');
ok(g && Math.abs(g.d7.left - 0.9894) < 1e-6 && Math.abs(g.h5.left - 0.9896) < 1e-6, `1 Gemini 묶음 7일 98.94% · 5시간 98.96% (${g?.d7?.left} · ${g?.h5?.left})`);
ok(g?.d7.resetAt === now + (145 * 60 + 49) * 60000 && g?.h5.resetAt === now + (4 * 60 + 16) * 60000, '1 초기화 시각 = 지금 + 남은 시간');
ok(o && o.d7.left === 1 && o.h5.left === 1 && o.d7.resetAt === null, '1 Claude·GPT 묶음 100% · 「Quota available」= 초기화 시각 없음');
ok(x && x.label === 'GEMINI 4 ARGON' && Math.abs(x.d7.left - 0.998) < 1e-6 && !x.h5, `1 Argon 묶음 = 7일만 99.80% (${x?.label})`);
ok(u?.groups.length === 3, '1 묶음 3개');

// 화면에서 빈 줄이 커서 이동으로만 그려지면 계정 뒤에 다음 머리글이 붙는다(2026-11-24 실측: …comGEMINI)
const stuck = parseUsage(sample.replace(/(someone@example\.com)\s+GEMINI MODELS/, '$1GEMINI MODELS'), now);
ok(stuck?.account === 'someone@example.com' && stuck.groups.length === 3, `1 계정 뒤에 머리글이 붙어도 계정만 (${stuck?.account})`);

// 2) 작은 부품
ok(parseDuration('145h 49m') === (145 * 60 + 49) * 60000 && parseDuration('2d 3h') === (51) * 3600000 && parseDuration('—') === null, '2 남은 시간 글 → 밀리초');
ok(cleanScreen('\x1b[1;32mA\x1b[0m\r\nB') === 'A\nB', '2 색 코드 지우기');
ok(parseUsage('아무 화면') === null && parseUsage('GEMINI MODELS\n  Models within this group: x  (막대 없음) Limit') === null, '2 막대가 없으면 null(지난 값 유지)');

// 3) 가짜 터미널로 읽는 순서 전체(부팅 → /usage → 해석 → 저장, 실패 시 지난 값 유지)
function fakePty(script) {
  return (exe, args, opts) => {
    const h = { data: null, exit: null, wrote: [], killed: false };
    const emit = (s) => setTimeout(() => h.data?.(s), 0);
    setTimeout(() => emit(script.boot), 50);
    return {
      onData: (f) => { h.data = f; }, onExit: (f) => { h.exit = f; },
      write: (s) => { h.wrote.push(s); if (s === '\r' && script.usage) setTimeout(() => emit(script.usage), 100); },
      kill: () => { h.killed = true; }, _h: h, opts,
    };
  };
}
{
  const st = path.join(tmp, 'st1'), home = path.join(tmp, 'agyhome');
  const gu = new GeminiUsage({ stateDir: st, agyExe: () => 'agy.exe', agyHome: home, intervalMs: 0, spawn: fakePty({ boot: 'banner\n? for shortcuts', usage: sample }) });
  const v = await gu.refresh();
  ok(v.ok === true && v.groups?.length === 3 && v.account === 'someone@example.com', '3 가짜 터미널: 읽고 해석');
  const saved = JSON.parse(fs.readFileSync(path.join(st, 'gemini-usage.json'), 'utf8'));
  ok(saved.ok && saved.at > 0, '3 state\\gemini-usage.json 저장');
  const trusted = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8')).trustedWorkspaces || [];
  ok(trusted.some((w) => w.toLowerCase() === path.join(st, 'agy-usage').toLowerCase()), '3 읽기 폴더를 미리 믿는 폴더로 적음(물음 창 방지)');
  const gu2 = new GeminiUsage({ stateDir: st, agyExe: () => 'agy.exe', agyHome: home, intervalMs: 0, spawn: fakePty({ boot: 'Do you trust the contents of this project?' }) });
  const v2 = await gu2.refresh();
  ok(v2.ok === false && v2.error === 'trust-prompt' && v2.groups?.length === 3, '3 실패하면 error 를 적고 지난 값은 그대로');
  const gu3 = new GeminiUsage({ stateDir: path.join(tmp, 'st3'), agyExe: () => null, agyHome: home, intervalMs: 0 });
  ok((await gu3.refresh()).error === 'agy-missing', '3 agy 없음 = agy-missing');
  ok(gu3.get().installed === false && new GeminiUsage({ stateDir: path.join(tmp, 'st4'), agyExe: () => 'agy.exe', agyHome: home, intervalMs: 0 }).get().installed === true, '3 프로그램이 있는지 함께 알림(읽기 전에도 머리줄에 칸을 보이려고)');
  ok(gu3.firstDelayMs <= 15000, '3 켠 뒤 첫 읽기는 15초 안에 시작');
  const a = gu.refresh(), b = gu.refresh(); ok(a === b, '3 동시에 두 번 돌지 않음'); await a;
}

// 3-2) 머리줄 칸(화면 코드에서 함수만 꺼내 확인): 읽기 전·실패여도 프로그램이 있으면 보이고, 없으면 숨긴다
{
  const src = fs.readFileSync(path.join(HERE, '..', 'app', 'settings.js'), 'utf8'); const m = /  function geminiCell\(gem\) \{[\s\S]*?\n  \}/.exec(src);
  ok(!!m, '3-2 geminiCell 이 있음');
  if (m) {
    const cell = new Function('battery', 'left', `${m[0]}; return geminiCell;`)((l, acc, wins, title) => ({ l, wins, title }), (v) => Math.round((1 - v) * 100));
    ok(cell({ ok: false, error: 'not-yet', installed: false }) === '' && cell(null) === '', '3-2 프로그램 없음 = 숨김');
    const wait = cell({ ok: false, error: 'not-yet', installed: true }); ok(wait.l === 'Gemini' && wait.wins.every((w) => w.v === null) && /읽는 중/.test(wait.title), '3-2 읽기 전 = 빈 칸 + 읽는 중');
    ok(/로그인/.test(cell({ ok: false, error: 'login-needed', installed: true }).title), '3-2 로그인 필요를 말풍선으로');
    const good = cell({ ok: true, installed: true, account: 'a@b.c', groups: [{ key: 'gemini', h5: { left: .4 }, d7: { left: .9 } }] }); ok(good.wins.length === 2 && Math.abs(good.wins[0].v - .6) < 1e-9 && Math.abs(good.wins[1].v - .1) < 1e-9, '3-2 값이 있으면 5시간·주간');
    ok(/지난 값/.test(cell({ ok: false, error: 'x', installed: true, groups: [{ key: 'gemini', h5: null, d7: { left: 1 } }] }).title), '3-2 실패 + 지난 값 = 지난 값이라고 알림');
  }
}

// 4) (--live) 진짜 agy
if (process.argv.includes('--live')) {
  const exe = agyExe();
  if (!exe) ok(false, '4 agy 없음');
  else {
    const st = path.join(tmp, 'live');
    const gu = new GeminiUsage({ stateDir: st, agyExe: () => exe, agyHome: AGY_HOME, intervalMs: 0, log: (m) => console.log('   ', m) });
    const t0 = Date.now(); const v = await gu.refresh();
    ok(v.ok === true && v.groups?.some((x) => x.key === 'gemini' && x.d7), `4 진짜 /usage 읽기 (${((Date.now() - t0) / 1000).toFixed(1)}초, ${v.error || 'ok'})`);
    // 시험 폴더는 진짜 agy 믿는 목록에서 뺀다
    const f = path.join(AGY_HOME, 'settings.json');
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); const d = path.join(st, 'agy-usage').toLowerCase(); j.trustedWorkspaces = (j.trustedWorkspaces || []).filter((w) => String(w).toLowerCase() !== d); fs.writeFileSync(f, JSON.stringify(j, null, 2)); console.log('    (시험 폴더를 agy 믿는 목록에서 뺌)'); } catch {}
    await new Promise((r) => setTimeout(r, 3000)); // 닫히는 시간
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
