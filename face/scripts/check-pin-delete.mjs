// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// 작업목록 고정 · 삭제(P18, 2026-11-19 사용자 요청) 무접촉 검사.
//   1) 데몬 setPinned()/forget(): 임시 state + 가짜 pty — 저장·다시 읽어도 유지·끄기
//   2) 정적: 데몬 /pin 라우트 · 화면 메뉴·Esc·네이티브 confirm 금지 · 끝난 대화 지우기 단추
//   3) 화면(playwright 있을 때 — `playwright` 또는 env PLAYWRIGHT_CORE): 시험 데몬 3459 + 가짜 끝난 대화 3개
//      오른쪽 클릭 메뉴 → 고정(맨 위 「고정됨」) · ⋯ → 삭제(확인 창) · 끝난 대화 지우기(고정은 남음). IRIS_CAPTURE_DIR 면 캡처.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SessionManager } from '../daemon/sessions.mjs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log(`PASS ${name}`); } else { fail++; console.log(`FAIL ${name}`); } };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DEAD = 999999, cwd = process.cwd();
const seed = (dir) => fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify(['a', 'b', 'c'].map((id, i) => ({ id: `s${id}`, cwd, agent: 'claude', model: 'opus', effort: 'high', status: 'exited', pid: DEAD, sessionId: null, title: `대화 ${i + 1}`, titleSource: 'user' })), null, 2), 'utf8');

// ---------- 1) 데몬 ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-pin-')); seed(dir);
  class FakePty { constructor() { this.pid = 42000; } onData() {} onExit() {} write() {} resize() {} kill() {} }
  class TestSM extends SessionManager { spawn() { return new FakePty(); } }
  let lists = 0; const sm = new TestSM(dir, { onList: () => { lists++; } });
  const saved = (id) => JSON.parse(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8')).find((r) => r.id === id);
  ok(sm.setPinned('sb', true)?.pinned === true && saved('sb').pinned === true && lists === 1, '1 고정 → sessions.json 에 pinned · 목록 방송');
  const sm2 = new TestSM(dir, {}); ok(sm2.get('sb')?.pinned === true, '1 다시 읽어도(재시작) 고정 유지');
  sm.setPinned('sb', false); ok(!('pinned' in saved('sb')), '1 고정 풀기 = 항목 지움');
  ok(sm.setPinned('nope', true) === null, '1 없는 대화 = null(404)');
  sm.forget('sc'); ok(!saved('sc') && !sm.get('sc'), '1 삭제(forget) = 목록·저장에서 빠짐');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- 2) 정적 ----------
{
  const srv = src('daemon/server.mjs'), main = src('app/main.js'), html = src('app/index.html'), css = src('app/style.css');
  ok(/\/api\\\/sessions\\\/\(\[a-z0-9\]\+\)\\\/pin\$/.test(srv) && /sm\.setPinned\(mpin\[1\], !!b\.pinned\)/.test(srv), '2 데몬 POST /api/sessions/:id/pin');
  ok(srv.indexOf("const mpin") > srv.indexOf("const mo = p.match(/^\\/api\\/sessions\\/([a-z0-9]+)(?:\\/|$)/)"), '2 /pin 은 개인 공간 공통 검사 뒤에');
  ok(/if \(RowMenu\.close\(\)\) return;/.test(main) && main.indexOf('RowMenu.close()') < main.indexOf('Voice.cancel()'), '2 Esc = 메뉴만 닫기(작업 중단보다 먼저)');
  ok(!/[^.\w]confirm\(/.test(main.replace(/Dialog\.confirm\(/g, '')), '2 네이티브 confirm() 없음(Dialog 만)');
  ok(/id="btn-clean"[^>]*hidden/.test(html) && /function cleanEnded/.test(main) && /!s\.pinned && isEnded\(s\)/.test(main), '2 끝난 대화 지우기 = 고정 제외·끝난 것만');
  ok(/\.row-menu \{/.test(css) && /\.sessions \.sgroup \{/.test(css), '2 메뉴·묶음 꾸밈');
}

// ---------- 3) 화면 ----------
const req = createRequire(import.meta.url);
let pw = null;
for (const c of [process.env.PLAYWRIGHT_CORE, 'playwright', 'playwright-core'].filter(Boolean)) { try { pw = req(c); break; } catch {} }
if (!pw?.chromium) console.log('SKIP 3절: playwright 없음 (env PLAYWRIGHT_CORE 로 경로를 줄 수 있음)');
else {
  const st = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-pin-ui-')), mods = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-pin-mods-'));
  seed(st); fs.writeFileSync(path.join(st, 'tutorial.json'), JSON.stringify({ doneAt: new Date().toISOString(), skipped: true, count: 1, step: 'd1' }));
  fs.writeFileSync(path.join(st, 'settings.json'), JSON.stringify({ intro: false }));
  const d = spawn(process.execPath, [path.join(ROOT, 'daemon', 'server.mjs')], { cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, IRIS_FACE_PORT: '3459', IRIS_FACE_STATE: st, IRIS_FACE_MODULES: mods, IRIS_FACE_AUTO_RESUME: '0', IRIS_FACE_UPDATE_CHECK: '0', IRIS_FACE_GEMINI_USAGE: '0' } });
  const cap = process.env.IRIS_CAPTURE_DIR;
  const savedUi = () => JSON.parse(fs.readFileSync(path.join(st, 'sessions.json'), 'utf8'));
  let b = null;
  try {
    let up = false; for (let i = 0; i < 80 && !up; i++) { await new Promise((r) => setTimeout(r, 250)); try { up = (await fetch('http://127.0.0.1:3459/api/health')).ok; } catch {} }
    ok(up, '3 시험 데몬(3459)');
    b = await pw.chromium.launch({ channel: 'msedge', headless: true });
    const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
    await p.goto('http://127.0.0.1:3459/'); await p.waitForSelector('#session-list .srow', { timeout: 8000 });
    ok((await p.$$('#session-list .srow')).length === 3, '3 끝난 대화 3개가 목록에');
    ok(await p.isVisible('#btn-clean'), '3 끝난 대화가 있으면 휴지통 단추가 보임');
    await p.click('#session-list .srow[data-id="sc"]', { button: 'right' });
    ok(await p.isVisible('.row-menu'), '3 오른쪽 클릭 = 줄 메뉴');
    await p.click('.row-menu button[data-act="pin"]'); await p.waitForTimeout(500);
    const first = await p.$eval('#session-list .srow', (e) => e.dataset.id);
    const groups = await p.$$eval('#session-list .sgroup', (a) => a.map((e) => e.textContent));
    ok(first === 'sc' && groups.join() === '고정됨,대화' && savedUi().find((r) => r.id === 'sc')?.pinned === true, `3 고정 → 맨 위 「고정됨」 묶음 · 저장 (${first} · ${groups.join('/')})`);
    if (cap) await p.screenshot({ path: path.join(cap, 'pin-delete-1-pinned.png') });
    await p.hover('#session-list .srow[data-id="sa"]'); await p.click('#session-list .srow[data-id="sa"] .smore');
    if (cap) await p.screenshot({ path: path.join(cap, 'pin-delete-2-menu.png') });
    await p.click('.row-menu button[data-act="delete"]');
    await p.waitForSelector('#dlg:not([hidden])', { timeout: 3000 });
    ok((await p.textContent('#dlg-ok')) === '지우기', '3 삭제 = 확인 창(페이지 Dialog)');
    if (cap) await p.screenshot({ path: path.join(cap, 'pin-delete-3-confirm.png') });
    await p.click('#dlg-ok'); await p.waitForTimeout(600);
    ok(!(await p.$('#session-list .srow[data-id="sa"]')) && !savedUi().find((r) => r.id === 'sa'), '3 확인 → 목록·저장에서 빠짐');
    await p.click('#btn-clean'); await p.waitForSelector('#dlg:not([hidden])', { timeout: 3000 });
    ok(/1개 지우기/.test(await p.textContent('#dlg-ok')), '3 끝난 대화 지우기 = 고정 제외 개수(1개)');
    await p.click('#dlg-ok'); await p.waitForTimeout(800);
    const left = savedUi().map((r) => r.id);
    ok(left.join() === 'sc' && !(await p.isVisible('#btn-clean')), `3 고정한 대화만 남고 휴지통 단추 숨음 (${left.join()})`);
    await p.click('#session-list .srow[data-id="sc"]', { button: 'right' }); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(!(await p.$('.row-menu')), '3 Esc = 메뉴 닫기');
    if (cap) await p.screenshot({ path: path.join(cap, 'pin-delete-4-after.png') });
  } catch (e) { ok(false, '3 화면 시험 오류: ' + e.message); }
  finally {
    try { await b?.close(); } catch {}
    try { execFileSync('taskkill', ['/PID', String(d.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    await new Promise((r) => setTimeout(r, 1200));
    for (const x of [st, mods]) { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }
  }
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
