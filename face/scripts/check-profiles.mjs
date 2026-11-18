// 개인 공간 검사(P18 조각 C, 2026-11-12) — 시험 데몬 3459(임시 상태). 실제 CLI·세션 접촉 0(세션 기록은 sessions.json 에 미리 둔다).
//   ① 공간 만들기·PIN 검사·틀린 PIN 5번 기다림  ② 목록 가리기(잠긴 세션 = 껍데기만)·하위 길 403·통로 붙기 거절
//   ③ 화면: 칩 · 공간 열기 · 잠그기 · 잠긴 세션 숨김   npm run verify:profiles  (playwright 없으면 ③ SKIP)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { Profiles } from '../daemon/profiles.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3459, BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0, skip = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`PASS ${n}`); } else { fail++; console.log(`FAIL ${n}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ① 공간 저장소(파일만)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-pf-'));
  let t = 1e12; const pf = new Profiles({ file: path.join(dir, 'profiles.json'), now: () => t });
  const a = pf.create('김선생', '1234');
  ok(a.token && pf.who(a.token) === a.id, '1 만들면 바로 열림(열쇠)');
  ok(!fs.readFileSync(path.join(dir, 'profiles.json'), 'utf8').includes('1234'), '1 PIN 은 파일에 저장되지 않음(지문만)');
  ok((() => { try { pf.create('이', '12'); return false; } catch { return true; } })(), '1 PIN 4자리 미만 거절');
  ok((() => { try { pf.create('김선생', '9999'); return false; } catch { return true; } })(), '1 같은 이름 거절');
  for (let i = 0; i < 5; i++) { try { pf.unlock(a.id, '0000'); } catch {} }
  ok((() => { try { pf.unlock(a.id, '1234'); return false; } catch (e) { return e.code === 'WAIT'; } })(), '1 틀린 PIN 5번 = 맞는 PIN 도 잠시 기다림');
  t += 31000; ok(!!pf.unlock(a.id, '1234').token, '1 30초 뒤에는 열림');
  pf.lock(a.token); ok(pf.who(a.token) === null, '1 잠그면 열쇠 사라짐');
  fs.rmSync(dir, { recursive: true, force: true });
}

const state = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-pf-'));
const mods = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-pf-mods-'));
fs.writeFileSync(path.join(state, 'settings.json'), JSON.stringify({ voice: { preload: false }, intro: false }));
fs.writeFileSync(path.join(state, 'sessions.json'), '[]');
const env = { ...process.env, IRIS_FACE_PORT: String(PORT), IRIS_FACE_STATE: state, IRIS_FACE_MODULES: mods, IRIS_FACE_AUTO_RESUME: '0', IRIS_FACE_UPDATE_CHECK: '0' };
const startD = async () => { const d = spawn(process.execPath, [path.join(ROOT, 'daemon', 'server.mjs')], { cwd: ROOT, windowsHide: true, stdio: 'ignore', env }); for (let i = 0; i < 60; i++) { await sleep(250); try { if ((await fetch(`${BASE}/api/health`)).ok) return d; } catch {} } return d; };
const jpost = (p, b, h = {}) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) });
let d, browser;
try {
  d = await startD();
  const made = await (await jpost('/api/profiles/create', { name: '김선생', pin: '2580' })).json();
  ok(!!made.id, '2 데몬: 공간 만들기');
  process.kill(d.pid); await sleep(500);
  // 남의 공간 세션 하나 + 공용 세션 하나를 미리 둔다(실제 CLI 를 띄우지 않으려고)
  const base = { agent: 'claude', model: 'opus', effort: 'high', cwd: state, status: 'exited', createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(state, 'sessions.json'), JSON.stringify([{ ...base, id: 'ss1', title: '비밀 상담 기록', owner: made.id }, { ...base, id: 'ss2', title: '공용 세션' }]));
  d = await startD();
  const anon = await (await fetch(`${BASE}/api/sessions`)).json();
  const s1 = anon.find((s) => s.id === 'ss1'), s2 = anon.find((s) => s.id === 'ss2');
  ok(s1?.locked && !s1.title && !s1.cwd && s2?.title === '공용 세션', '2 잠긴 화면 목록 = 남의 세션은 껍데기만(제목·폴더 없음)');
  ok((await fetch(`${BASE}/api/sessions/ss1/transcript`)).status === 403, '2 열쇠 없이 기록 = 403');
  ok((await jpost('/api/sessions/ss1/send', { text: 'x' })).status === 403, '2 열쇠 없이 보내기 = 403');
  ok((await jpost('/api/sessions/ss1/title', { title: 'x' })).status === 403, '2 열쇠 없이 이름 바꾸기 = 403');
  ok((await jpost('/api/profiles/unlock', { id: made.id, pin: '0000' })).status === 400, '2 틀린 PIN = 거절');
  const un = await (await jpost('/api/profiles/unlock', { id: made.id, pin: '2580' })).json();
  const h = { 'x-iris-profile': un.token };
  const mine = await (await fetch(`${BASE}/api/sessions`, { headers: h })).json();
  ok(mine.find((s) => s.id === 'ss1')?.title === '비밀 상담 기록', '2 열쇠가 있으면 내 세션 그대로');
  ok((await fetch(`${BASE}/api/sessions/ss1/transcript`, { headers: h })).status !== 403, '2 열쇠가 있으면 기록 길 열림');
  // 통로
  const wsTry = (msgs) => new Promise((res) => { const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); const got = []; ws.on('open', () => msgs.forEach((m) => ws.send(JSON.stringify(m)))); ws.on('message', (m) => { got.push(JSON.parse(m)); }); setTimeout(() => { ws.close(); res(got); }, 900); });
  const g1 = await wsTry([{ type: 'attach', id: 'ss1' }]);
  ok(g1.some((m) => m.type === 'error' && /잠긴/.test(m.error)) && !g1.some((m) => m.type === 'replay'), '2 통로: 열쇠 없이 붙기 = 거절');
  const hello = g1.find((m) => m.type === 'hello'); ok(hello && !hello.sessions.find((s) => s.id === 'ss1').title, '2 통로 첫 인사도 남의 세션은 껍데기');
  const g2 = await wsTry([{ type: 'profile', token: un.token }, { type: 'attach', id: 'ss1' }]);
  ok(g2.some((m) => m.type === 'replay' && m.id === 'ss1'), '2 통로: 열쇠를 알리면 붙기 됨');
  await jpost('/api/profiles/lock', {}, h);
  ok((await fetch(`${BASE}/api/sessions/ss1/transcript`, { headers: h })).status === 403, '2 잠근 뒤 옛 열쇠 = 403');

  // ③ 화면
  const req = createRequire(import.meta.url);
  let pw = null; for (const c of ['playwright', path.join(process.env.APPDATA || '', 'npm/node_modules/playwright')]) { try { pw = req(c); break; } catch {} }
  if (!pw) { skip++; console.log('SKIP 3 화면(playwright 없음)'); }
  else {
    browser = await pw.chromium.launch();
    const p = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE); await sleep(1500);
    const side = async () => p.locator('#sidebar, #side, .side, aside').first().textContent().catch(() => '');
    ok((await p.locator('#profile-chip').textContent()).includes('공용') && /잠긴 세션 1개/.test(await p.locator('#profile-chip').getAttribute('title')), '3 칩 = 공용 · 잠긴 세션 1개');
    ok(await p.evaluate(() => document.body.innerText.includes('비밀 상담 기록')) === false, '3 화면 어디에도 남의 세션 제목 없음');
    await p.click('#profile-chip'); await sleep(300);
    await p.click('.pf-who'); await sleep(200);
    await p.fill('#pf-pin', '1111'); await p.click('[data-pf="unlock"]'); await sleep(400);
    ok(/PIN 이 맞지 않습니다/.test(await p.locator('.pf-box').textContent()), '3 틀린 PIN = 창 안에 이유');
    await p.fill('#pf-pin', '2580'); await p.keyboard.press('Enter'); await sleep(800);
    ok((await p.locator('#profile-chip').textContent()).includes('김선생 공간') && await p.locator('#pf-modal').isHidden(), '3 맞는 PIN(Enter) = 김선생 공간');
    ok(await p.evaluate(() => document.body.innerText.includes('비밀 상담 기록')), '3 열면 내 세션이 목록에 보임');
    await p.click('#profile-chip'); await sleep(200); await p.click('[data-pf="lock"]'); await sleep(700);
    ok((await p.locator('#profile-chip').textContent()).includes('공용') && await p.evaluate(() => !document.body.innerText.includes('비밀 상담 기록')), '3 잠그면 다시 숨김');
    ok(errs.length === 0, `3 페이지 오류 0건${errs.length ? ': ' + errs.join(' | ') : ''}`);
  }
} catch (e) { console.error(e); fail++; }
finally {
  try { await browser?.close(); } catch {}
  try { process.kill(d.pid); } catch {}
  await sleep(300);
  for (const dir of [state, mods]) fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} PASS / ${fail} FAIL / ${skip} SKIP`);
process.exit(fail ? 1 : 0);
