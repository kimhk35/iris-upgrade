// 고도화 4차 검사(P18 2026-11-25): 쓰던 글 대화마다 · 폴더별 묶기 · 빠른 찾기(Ctrl+K) · 두 AI 견주기 · 새로운 점 · 업데이트 물음 · 건강 점검.
// 시험 데몬 3459 + 헤드리스 Edge(PLAYWRIGHT_CORE). 진짜 AI·바깥 전송 0(견주기는 가짜 응답으로 가로챔).   npm run verify:round4
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runHealth, SITES } from '../daemon/healthcheck.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`PASS ${n}`); } else { fail++; console.log(`FAIL ${n}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// 1) 건강 점검
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-r4-'));
  const base = { root: 'C:\\', stateDir: tmp, agents: () => ({ missing: [], accounts: { claude: 1, codex: 1 } }), auth: () => ({ items: [{ label: '비밀 이름', level: 'ok' }] }), memory: () => ({ freeGB: 12 }), docPython: () => true, proxyPort: 3456, update: () => ({ mode: 'package', installed: { package: '2.1.5' } }) };
  const date = new Date().toUTCString(); const sent = [];
  const deps = { fetchImpl: async (u, o) => { sent.push([u, o.method, o.body]); return { headers: { get: () => date } }; }, has: async () => true, port: async () => true, statfs: () => ({ bavail: 100, bsize: 1e9 }) };
  const good = await runHealth(base, deps);
  ok(good.every((x) => x.level === 'ok') && good.length >= 9, `1 모두 정상 (${good.length}항목)`);
  ok(sent.length === SITES.length && sent.every((s) => s[1] === 'HEAD' && s[2] === undefined), '1 바깥에는 내용 없는 HEAD 만');
  ok(!JSON.stringify(good).includes('비밀 이름') && !JSON.stringify(good).includes(tmp), '1 계정 이름·경로를 싣지 않음');
  const bad = await runHealth({ ...base, agents: () => ({ missing: ['codex'], accounts: { claude: 0, codex: 0 } }), auth: () => ({ items: [{ level: 'expired' }, { level: 'expired', optional: true }] }), memory: () => ({ freeGB: 0.5 }), docPython: () => false, update: () => ({ mode: 'package', headline: { version: '2.1.6' }, plan: {} }) }, { ...deps, fetchImpl: async () => { throw new Error('x'); }, port: async () => false, statfs: () => ({ bavail: 1, bsize: 1e9 }) });
  const lv = Object.fromEntries(bad.map((x) => [x.id, x.level]));
  ok(['net', 'cli', 'login', 'relay', 'disk', 'mem', 'doc'].every((k) => lv[k] === 'bad') && lv.update === 'warn', `1 문제를 찾음 (${Object.entries(lv).map((x) => x.join('=')).join(' ')})`);
  ok(bad[0].level === 'bad' && bad.at(-1).level === 'ok' && bad.filter((x) => x.level === 'bad').every((x) => x.fix), '1 나쁜 것부터 · 고치는 법이 있음');
  const late = await runHealth(base, { ...deps, fetchImpl: async () => ({ headers: { get: () => new Date(Date.now() - 20 * 60000).toUTCString() } }) });
  ok(late.find((x) => x.id === 'clock').level === 'bad', '1 시계가 어긋나면 알림');
  fs.rmSync(tmp, { recursive: true, force: true });
}
// 2) 정적
{
  const rel = JSON.parse(rd('package.json')).iris.release, wn = rd('app/whatsnew.js');
  ok(new RegExp(`RELEASE = '${String(rel).replaceAll('.', '\\.')}'`).test(wn), `2 새로운 점의 판 = package.json iris.release (${rel})`);
  for (const f of ['drafts', 'palette', 'compare', 'whatsnew']) ok(rd('app/index.html').indexOf(`/app/${f}.js`) < rd('app/index.html').indexOf('/app/main.js') && rd('app/index.html').includes(`/app/${f}.js`), `2 ${f}.js 가 main.js 앞에`);
  const panes = /const PANES = \[([^\]]+)\]/.exec(rd('app/settings.js'))[1].match(/'(\w+)'/g).map((x) => x.slice(1, -1));
  const inPal = [...rd('app/palette.js').match(/const SET = (\[\[.+\]\]);/)[1].matchAll(/\['[^']+', '(\w+)'/g)].map((m) => m[1]);
  ok(panes.every((x) => inPal.includes(x)), '2 빠른 찾기가 설정 묶음을 모두 앎');
}
// 3) 화면
const req = createRequire(import.meta.url); let pw = null;
for (const c of [process.env.PLAYWRIGHT_CORE, 'playwright', 'playwright-core'].filter(Boolean)) { try { pw = req(c); break; } catch {} }
if (!pw?.chromium) console.log('SKIP 3 화면(playwright 없음)');
else {
  const st = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-r4-st-')), mods = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-r4-md-')), A = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-r4-가-')), B = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-r4-나-'));
  const mk = (id, title, cwd, agent = 'claude') => ({ id, agent, model: 'opus', modelLabel: 'Opus', effort: 'high', cwd, title, titleSource: 'user', status: 'exited', sessionId: `00000000-0000-4000-8000-0000000000${id.length}${id.charCodeAt(1).toString(16)}`, createdAt: new Date().toISOString(), pid: 0 });
  fs.writeFileSync(path.join(st, 'sessions.json'), JSON.stringify([mk('sa', '가 하나', A), mk('sb', '나 하나', B), mk('sc', '가 둘', A, 'codex')]));
  fs.writeFileSync(path.join(st, 'tutorial.json'), JSON.stringify({ doneAt: new Date().toISOString(), skipped: true, count: 1, step: 'd1' }));
  fs.writeFileSync(path.join(st, 'settings.json'), JSON.stringify({ intro: false, privacyCheck: false, voice: { preload: false } }));
  const d = spawn(process.execPath, [path.join(ROOT, 'daemon', 'server.mjs')], { cwd: ROOT, stdio: 'ignore', windowsHide: true, env: { ...process.env, IRIS_FACE_PORT: '3459', IRIS_FACE_STATE: st, IRIS_FACE_MODULES: mods, IRIS_FACE_AUTO_RESUME: '0', IRIS_FACE_UPDATE_CHECK: '0', IRIS_FACE_GEMINI_USAGE: '0' } });
  const cap = process.env.IRIS_CAPTURE_DIR; let b = null;
  try {
    let up = false; for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch('http://127.0.0.1:3459/api/health')).ok; } catch {} }
    ok(up, '3 시험 데몬(3459)');
    b = await pw.chromium.launch(process.env.PLAYWRIGHT_CORE ? { channel: 'msedge' } : {});
    const ctx = await b.newContext({ viewport: { width: 1360, height: 820 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const shot = async (n) => { if (cap) await p.screenshot({ path: path.join(cap, `r4-${n}.png`) }); };
    await p.goto('http://127.0.0.1:3459/'); await p.waitForSelector('#session-list .srow'); await p.waitForTimeout(2600);
    // 새로운 점: 쓰던 PC 에 한 번
    ok(await p.locator('.wn').count() === 1 && await p.locator('.wn li').count() === await p.evaluate(() => WhatsNew.count), '3 새로운 점 카드'); await shot('whatsnew');
    await p.click('.wn [data-x]'); await p.reload(); await p.waitForSelector('#session-list .srow'); await p.waitForTimeout(2600);
    ok(await p.locator('.wn').count() === 0, '3 새로운 점은 한 번만');
    ok(await p.evaluate(() => { localStorage.removeItem('iris.release.seen'); const r = WhatsNew.maybe({ used: false }); return r === false && localStorage.getItem('iris.release.seen') === WhatsNew.release; }), '3 새로 설치한 PC 에는 띄우지 않음');
    // 쓰던 글
    const T = '#composer-text', row = (id) => p.click(`.srow[data-id="${id}"]`);
    await p.fill(T, '홈에 쓰던 글'); await row('sa'); ok(await p.inputValue(T) === '', '3 다른 대화로 가면 빈 칸'); await p.fill(T, 'A 글');
    await row('sb'); ok(await p.inputValue(T) === '', '3 A 글이 B 로 따라오지 않음'); await p.fill(T, 'B 글'); await row('sa');
    ok(await p.inputValue(T) === 'A 글', '3 돌아오면 A 글'); await p.waitForTimeout(400);
    ok(await p.locator('.srow[data-id="sb"] .sdraft').count() === 1 && await p.locator('.srow[data-id="sa"] .sdraft').count() === 0, '3 쓰던 글 표시는 다른 대화 줄에만'); await shot('drafts');
    await p.click('#btn-home'); ok(await p.inputValue(T) === '홈에 쓰던 글', '3 첫 화면의 글도 따로');
    await p.reload(); await p.waitForSelector('#session-list .srow'); await p.waitForTimeout(700); ok(await p.inputValue(T) === '홈에 쓰던 글', '3 껐다 켜도 남음'); await row('sb'); ok(await p.inputValue(T) === 'B 글', '3 껐다 켜도 대화마다');
    // 보내는 사이 옮겨도 다른 대화 글은 지우지 않음
    await p.route('**/api/sessions/sb/send', async (r) => { await sleep(700); await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
    await p.click('#btn-send'); await p.waitForTimeout(100); await row('sa'); await p.waitForTimeout(1200);
    ok(await p.inputValue(T) === 'A 글', '3 B 를 보내는 사이 A 로 옮겨도 A 글은 그대로'); await row('sb'); ok(await p.inputValue(T) === '', '3 보낸 B 글은 지워짐'); await p.unroute('**/api/sessions/sb/send');
    // 개인 공간에서 쓰던 글은 디스크에 남기지 않고 그 공간에서만 보인다
    await p.evaluate(() => { window.__me = Profile.me; Profile.me = () => ({ id: 'p1', name: '시험' }); }); await row('sa'); await p.fill(T, '비밀글'); await p.waitForTimeout(500);
    ok(!/비밀글/.test(await p.evaluate(() => JSON.stringify(localStorage))), '3 개인 공간에서 쓰던 글은 디스크에 남지 않음');
    await p.evaluate(() => { Profile.me = window.__me; }); await row('sb'); await row('sa'); ok(await p.inputValue(T) === 'A 글', '3 잠그면 공용 글만 보임');
    // 폴더별 묶기
    await row('sb');     await p.click('.rail-mnu [data-mnu]'); await p.click('[data-group="folder"]'); await p.waitForTimeout(400);
    const heads = await p.$$eval('.sfold-h', (a) => a.map((e) => e.querySelector('small').textContent)); ok(heads.join() === '2,1', `3 폴더별 묶음 (${heads})`);
    const order = await p.$$eval('.srow', (a) => a.map((e) => e.dataset.id)); ok(order.join() === 'sa,sc,sb', `3 같은 폴더끼리 (${order})`); await shot('group');
    await p.click('.sfold-h button >> nth=0'); await p.waitForTimeout(300); ok((await p.$$('.srow')).length === 1, '3 접으면 그 폴더 대화가 숨음(보던 대화 B 만)');
    await p.reload(); await p.waitForSelector('.sfold-h'); ok(await p.locator('.sfold-h.shut').count() === 1, '3 접은 것을 기억'); await p.click('.sfold-h button >> nth=0');
    await p.click('.rail-mnu [data-mnu]'); await p.click('.rail-mnu [data-group=""]'); await p.waitForTimeout(300); ok(await p.locator('.sfold-h').count() === 0, '3 한 줄로 되돌림');
    // 빠른 찾기
    await p.focus(T); await p.keyboard.press('Control+k'); await p.waitForTimeout(700); ok(await p.isVisible('#palette .srch-in') && await p.locator('.pal-i').count() > 8, '3 Ctrl+K = 대화·하는 일'); await shot('palette');
    await p.fill('#palette .srch-in', 'ㄷㅈㅇ'); await p.waitForTimeout(150); ok(/디자인/.test(await p.locator('.pal-i').first().innerText()), '3 첫소리로 설정 찾기(ㄷㅈㅇ → 디자인)');
    await p.fill('#palette .srch-in', '나 하나'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await p.waitForTimeout(300); ok(await p.locator('.srow[data-id="sb"].active').count() === 1 && !(await p.isVisible('#palette')), '3 Enter = 그 대화로');
    await p.keyboard.press('Control+k'); await p.waitForTimeout(200); await p.keyboard.press('Escape'); await p.waitForTimeout(200); ok(!(await p.isVisible('#palette')) && await p.evaluate(() => document.activeElement.id) === 'composer-text', '3 Esc = 닫고 입력창으로');
    await p.waitForTimeout(400); await p.keyboard.press('Control+k'); await p.waitForTimeout(500); await p.fill('#palette .srch-in', '건강'); await p.waitForTimeout(150); await p.keyboard.press('Enter');
    await p.waitForSelector('.hc-sum', { timeout: 40000 }); ok(await p.locator('.hc li').count() >= 5, `3 건강 점검 결과 (${await p.locator('.hc li').count()}항목)`); await shot('health'); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    // 견주기(가짜 응답)
    const sent = []; let n = 0;
    await p.route('**/api/sessions', async (r) => { if (r.request().method() !== 'POST') return r.continue(); sent.push(r.request().postDataJSON()); await r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: ['sa', 'sc'][n++] }) }); });
    for (const id of ['sa', 'sc']) { await p.route(`**/api/sessions/${id}/transcript`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{ kind: 'user', text: '질문' }, { kind: 'assistant', text: `**${id}** 의 답` }] }) })); await p.route(`**/api/sessions/${id}/title`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })); await p.route(`**/api/sessions/${id}/send`, (r) => { sent.push(['send', id, r.request().postDataJSON().text]); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }); }
    await p.evaluate(() => Compare.open('이차함수를 설명해 줘')); await p.waitForTimeout(300);
    const agents = await p.$$eval('.cmp [data-agent]', (a) => a.map((e) => e.value)); ok(new Set(agents).size === 2, `3 견주기: 서로 다른 두 AI (${agents})`);
    await p.click('.cmp [data-c="ask"]'); await p.waitForTimeout(2200);
    const made = sent.filter((x) => !Array.isArray(x)); ok(made.length === 2 && made.every((x) => /글로만 답해/.test(x.prompt) && x.prompt.includes('이차함수')) && made.every((x) => x.agent !== 'claude' || x.permission === 'plan') && made.every((x) => x.agent !== 'codex' || (x.sandbox === 'read-only' && x.approval === 'never')), '3 같은 질문 두 곳 · 읽기만 하는 방식');
    const texts = await p.$$eval('.cmp-chat', (a) => a.map((e) => e.innerText)); ok(/sa 의 답/.test(texts[0]) && /sc 의 답/.test(texts[1]), '3 두 답이 나란히'); await shot('compare');
    await p.fill('.cmp-q', '더 짧게'); await p.click('.cmp [data-c="ask"]'); await p.waitForTimeout(500); ok(sent.filter((x) => Array.isArray(x)).map((x) => x[1]).sort().join() === 'sa,sc', '3 이어 묻기도 두 곳');
    await p.setViewportSize({ width: 760, height: 820 }); await p.waitForTimeout(200); ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '3 좁은 창에서 안 넘침'); await p.setViewportSize({ width: 1360, height: 820 });
    await p.click('.cmp-col[data-i="1"] [data-c="go"]'); await p.waitForTimeout(400); ok(!(await p.isVisible('#compare')) && await p.locator('.srow[data-id="sc"].active').count() === 1, '3 이 대화로 이어 가기');
    // 업데이트 물음
    await p.evaluate(() => { const info = { mode: 'package', enabled: true, autoDownload: true, installed: { package: '2.1.5' }, latest: { package: { version: '2.1.6' } }, available: ['package'], headline: { version: '2.1.6' }, plan: { createdAt: 'x', items: [{ kind: 'face', version: '2.104.0' }] } }; Settings.onUpdate({ type: 'update', phase: 'auto-start', version: '2.1.6', size: 12e6, info }); Settings.onUpdate({ type: 'update', phase: 'ready', auto: true, info }); Settings.onUpdate({ type: 'update', phase: 'ready', auto: true, info }); });
    await p.waitForTimeout(500); ok(await p.locator('.toast.act').count() === 1 && /2\.1\.6 판을 받아 두었어요/.test(await p.locator('.toast.act').innerText()), '3 다 받으면 한 번만 물음'); await shot('update');
    await p.click('.toast.act .text-btn >> nth=1'); await p.waitForTimeout(500); ok(await p.locator('.toast.act').count() === 0, '3 나중에 = 닫기');
    await p.evaluate(() => Settings.onUpdate({ type: 'update', phase: 'auto', info: { mode: 'package', enabled: true, installed: {}, latest: { package: { version: '2.1.7', size: 598e6 } }, available: [], headline: { version: '2.1.7' }, autoSkip: 'metered' } })); await p.waitForTimeout(400);
    ok(/데이터 요금/.test(await p.locator('.toast.act').innerText()) && /598MB/.test(await p.locator('.toast.act').innerText()), '3 데이터 요금 연결이면 묻기');
    ok(errs.length === 0, `3 페이지 오류 0건 ${errs.join(' | ')}`);
  } catch (e) { ok(false, `3 화면 시험 오류: ${e.stack}`); }
  finally { try { await b?.close(); } catch {} try { process.kill(d.pid); } catch {} await sleep(800); for (const x of [st, mods, A, B]) { try { fs.rmSync(x, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} } }
}
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
