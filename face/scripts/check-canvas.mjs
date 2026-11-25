// 캔버스 검사(P18, 2026-11-12) — ① 기록에서 쓴 파일 뽑기(writtenFiles) ② 데몬 /api/fs·stat·text 와 그 보호막
// ③ 화면(시험 데몬 3459 + 헤드리스 브라우저): 저절로 열림 · 탭 · 실시간 새로고침 · 따라가기 · 고르기 → 입력창 · 세션마다 따로 · 좁은 창 떠 있는 창.
// 실제 CLI·세션 접촉 0(세션 기록은 Canvas.onItems 로 흉내).   npm run verify:canvas   (playwright 가 없으면 3절만 SKIP)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writtenFiles, docMentions } from '../daemon/transcript.mjs';
import { previewHtml, readText, depsMtime } from '../daemon/canvasfile.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3459, BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0, skip = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`PASS ${n}`); } else { fail++; console.log(`FAIL ${n}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ① writtenFiles
ok(writtenFiles('Write', { file_path: 'C:\\a\\b.html', content: 'x' })[0] === 'C:\\a\\b.html', '1 클로드 Write → file_path');
ok(writtenFiles('Edit', { file_path: 'C:\\a\\c.css' })[0] === 'C:\\a\\c.css', '1 클로드 Edit → file_path');
ok(writtenFiles('NotebookEdit', { notebook_path: 'C:\\n.ipynb' })[0] === 'C:\\n.ipynb', '1 NotebookEdit → notebook_path');
ok(writtenFiles('Read', { file_path: 'C:\\a\\b.html' }).length === 0, '1 읽기만 한 파일은 아님');
const patch = '*** Begin Patch\n*** Add File: web/index.html\n+<h1>x</h1>\n*** Update File: web/app.js\n@@\n-a\n+b\n*** End Patch';
const wf = writtenFiles('apply_patch', { input: patch });
ok(wf.length === 2 && wf[0] === 'web/index.html' && wf[1] === 'web/app.js', `1 코덱스 apply_patch → 추가·수정 파일 (${wf.join(',')})`);
ok(writtenFiles('apply_patch', patch).length === 2, '1 코덱스 apply_patch 글자 그대로도');

// 문서는 거의 늘 명령·문서 도구로 만든다 — 그 글 속 이름 뽑기(P18 2026-11-24 "캔버스에서 PPT 조회가 이상함")
const dm = (v) => docMentions(v);
ok(dm({ command: 'python -c "p.save(\'수업 자료.pptx\')"' }).includes('수업 자료.pptx'), '1 파이썬 명령 속 PPT 이름(따옴표 안 빈칸 포함)');
ok(dm({ command: 'python make.py out/결과.docx' }).includes('out/결과.docx'), '1 따옴표 없는 상대 경로 워드');
ok(dm({ out_path: 'C:\\일 감\\활동지.hwpx' }).includes('C:\\일 감\\활동지.hwpx'), '1 문서 도구 인자의 절대 경로 hwpx(빈칸)');
ok(dm('저장했습니다: C:\\일 감\\a (1).pptx 완료').some((x) => x === 'C:\\일 감\\a (1).pptx'), '1 결과 글 속 절대 경로');
ok(dm({ command: 'ls; echo hello.py x.pptx2' }).length === 0, '1 문서가 아닌 이름은 안 뽑음');

ok(['web/새그래프.png', '활동.html', '표.csv'].every((x) => dm({ command: 'python plot.py --out web/새그래프.png && start 활동.html && type 표.csv' }).includes(x)), '1 명령으로 만든 그림·웹페이지·표 이름');
{ // 원래 모습 그대로(canvasfile.mjs, 2026-11-25 점검)
  const cp949 = Buffer.from([0xb0, 0xa1, 0xb3, 0xaa]); // 가나
  ok(previewHtml(Buffer.concat([Buffer.from('<html><head><meta charset="euc-kr"></head><body>'), cp949, Buffer.from('</body></html>')])).includes('가나'), '1 EUC-KR 웹페이지 글자');
  const ph = previewHtml(Buffer.from('<!doctype html><head><title>x</title></head><body>a</body>'), { y: 120, tail: 'TAIL' });
  ok(ph.indexOf('localStorage') < ph.indexOf('<title>') && ph.includes('const y=120') && ph.endsWith('TAIL</body>'), '1 저장 대역은 맨 앞에 · 보던 자리 · 끝에 붙이기');
  ok(previewHtml(Buffer.from('<!doctype html><p>a'), { y: '1);alert(1' }).includes('const y=0'), '1 이상한 자리 값은 0');
  const tf = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-cvt-'));
  fs.writeFileSync(path.join(tf, 'a.txt'), '가나다라'.repeat(10)); const cut = readText(path.join(tf, 'a.txt'), 10);
  ok(cut.text === '가나다' && cut.truncated, `1 잘린 utf-8 끝 글자에서 깨지지 않음 (${cut.text})`);
  fs.writeFileSync(path.join(tf, 'b.csv'), cp949); ok(readText(path.join(tf, 'b.csv'), 100).text === '가나', '1 엑셀이 저장한 표(EUC-KR) 글자');
  fs.writeFileSync(path.join(tf, 'p.html'), '<link href="s.css?v=1">'); fs.writeFileSync(path.join(tf, 's.css'), 'a'); fs.utimesSync(path.join(tf, 's.css'), new Date(), new Date(Date.now() + 60000));
  const mt = fs.statSync(path.join(tf, 'p.html')).mtimeMs; ok(depsMtime(path.join(tf, 'p.html'), mt) > mt + 30000, '1 딸린 CSS 가 바뀌면 바뀐 것');
  fs.rmSync(tf, { recursive: true, force: true });
}

// ② 데몬
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-cv-'));
const mods = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-cv-mods-'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-cv-work-'));
fs.writeFileSync(path.join(state, 'settings.json'), JSON.stringify({ voice: { preload: false }, intro: false }));
fs.writeFileSync(path.join(state, 'sessions.json'), '[]');
fs.mkdirSync(path.join(work, 'web'));
const page = path.join(work, 'web', '활동지.html');
fs.writeFileSync(page, '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1 id="t">이차함수</h1><div class="card" id="c2">카드 2 · 꼭짓점</div></body></html>');
fs.writeFileSync(path.join(work, 'web', 'style.css'), 'h1{color:rgb(43,58,143)}');
fs.writeFileSync(path.join(work, 'web', 'app.js'), 'const a = 1;\nconsole.log(a);\n');
fs.mkdirSync(path.join(work, 'secrets')); fs.writeFileSync(path.join(work, 'secrets', 'k.json'), '{}');
const d = spawn(process.execPath, [path.join(ROOT, 'daemon', 'server.mjs')], { cwd: ROOT, windowsHide: true, stdio: 'ignore',
  env: { ...process.env, IRIS_FACE_PORT: String(PORT), IRIS_FACE_STATE: state, IRIS_FACE_MODULES: mods, IRIS_FACE_AUTO_RESUME: '0', IRIS_FACE_UPDATE_CHECK: '0' } });
const fsu = (p, q = '') => `${BASE}/api/fs/${p.split(/[\\/]/).map(encodeURIComponent).join('/')}${q}`;
let browser;
try {
  let up = false; for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await fetch(`${BASE}/api/health`)).ok; } catch {} }
  ok(up, `2 시험 데몬 ${PORT}`);
  const h = await fetch(fsu(page)); const hb = await h.text();
  ok(h.status === 200 && /sandbox allow-scripts/.test(h.headers.get('content-security-policy') || '') && !/iris-pick/.test(hb), '2 /api/fs HTML = 격리 헤더 · 고르기 스크립트 없음');
  ok(/iris-pick/.test(await (await fetch(fsu(page, '?pick=1'))).text()), '2 ?pick=1 = 고르기 스크립트 붙음');
  const css = await fetch(fsu(path.join(work, 'web', 'style.css'))); ok(css.status === 200 && /text\/css/.test(css.headers.get('content-type')), '2 상대 자원(style.css)도 경로형으로 내줌');
  const st = await (await fetch(`${BASE}/api/file/stat?path=${encodeURIComponent(page)}`)).json(); ok(st.exists && st.mtime > 0, '2 stat = 바뀜 시각');
  const tx = await (await fetch(`${BASE}/api/file/text?path=${encodeURIComponent(path.join(work, 'web', 'app.js'))}`)).json(); ok(/console\.log/.test(tx.text), '2 text = 코드 글자');
  ok((await fetch(fsu(path.join(work, 'secrets', 'k.json')))).status === 403, '2 secrets = 403');
  ok((await fetch(`${BASE}/api/file/stat?path=${encodeURIComponent('C:\\Windows\\win.ini')}`)).status === 403, '2 시스템 폴더 = 403');
  ok((await fetch(fsu(path.join(work, 'x.exe')))).status === 404 || (await fetch(fsu(path.join(work, 'x.exe')))).status === 415, '2 없는/모르는 종류 = 거절');

  // 문서 찾기: 이름 → 실제 파일(작업 폴더 기준)
  fs.mkdirSync(path.join(work, 'out', '깊은'), { recursive: true });
  for (const n of ['수업.pptx', path.join('out', '깊은', '보고서.docx')]) fs.writeFileSync(path.join(work, n), 'x');
  fs.writeFileSync(path.join(work, 'secrets', '비밀.pptx'), 'x');
  const find = async (...names) => (await (await fetch(`${BASE}/api/canvas/find?cwd=${encodeURIComponent(work)}${names.map((n) => `&name=${encodeURIComponent(n)}`).join('')}`)).json()).files;
  const f1 = await find('수업.pptx', '보고서.docx', path.join(work, '수업.pptx'), '없음.hwpx');
  ok(f1.length === 2 && f1[0].path === path.join(work, '수업.pptx') && f1[1].path.endsWith('보고서.docx') && f1[0].mtime > 0, `2 문서 찾기 = 상대·하위 폴더·절대, 없는 것 제외 (${f1.length})`);
  ok((await find('secrets/비밀.pptx', '비밀.pptx')).length === 0, '2 문서 찾기도 secrets 는 안 내줌');
  const bad = await fetch(`${BASE}/api/doc?pages=1&path=${encodeURIComponent(path.join(work, '없음.pptx'))}`);
  ok(bad.status === 404, '2 없는 문서 미리보기 = 404');
  const badFrame = await fetch(`${BASE}/api/doc?path=${encodeURIComponent(path.join(work, '없음.pptx'))}`, { headers: { 'sec-fetch-dest': 'iframe' } });
  ok(/text\/html/.test(badFrame.headers.get('content-type')) && /없/.test(await badFrame.text()), '2 미리보기 칸에서는 안내 화면(JSON 글자 아님)');

  // ③ 화면
  const req = createRequire(import.meta.url);
  let pw = null; for (const c of [process.env.PLAYWRIGHT_CORE, 'playwright', 'playwright-core', path.join(process.env.APPDATA || '', 'npm/node_modules/playwright')].filter(Boolean)) { try { pw = req(c); break; } catch {} }
  if (!pw) { skip++; console.log('SKIP 3 화면(playwright 없음)'); }
  else {
    browser = await pw.chromium.launch(process.env.PLAYWRIGHT_CORE ? { channel: 'msedge' } : {});
    const p = await browser.newPage({ viewport: { width: 1400, height: 860 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE); await sleep(1200);
    // 세션 화면을 흉내: 대화 칸을 보이고 세션 A 를 고른 셈
    await p.evaluate((w) => { document.querySelector('#view').hidden = false; Canvas.onSession('sA', w); }, work);
    ok(await p.locator('.cv-toggle').isVisible() && await p.locator('#canvas').isHidden(), '3 세션 화면 = 캔버스 단추 · 아직 닫힘(파일 없음)');
    await p.evaluate(() => Canvas.onItems('sA', [{ t: 1, kind: 'tool', name: 'Write', detail: 'web\\활동지.html', files: ['web\\활동지.html'] }], false));
    await sleep(800);
    ok(await p.locator('#canvas').isVisible(), '3 처음 파일이 생기면 저절로 열림');
    ok(await p.locator('.cv-tab.cur').textContent() === '활동지.html', '3 탭 = 상대 경로를 세션 폴더 기준으로 풀어 보임');
    const fr = p.frameLocator('.cv-view iframe');
    ok(await fr.locator('#t').textContent() === '이차함수', '3 HTML 미리보기 보임');
    ok(await fr.locator('#t').evaluate((e) => getComputedStyle(e).color) === 'rgb(43, 58, 143)', '3 페이지의 상대 경로 CSS 가 적용됨');
    ok(await p.evaluate(() => { try { return !!document.querySelector('.cv-view iframe').contentDocument; } catch { return false; } }) === false, '3 미리보기는 IRIS 와 다른 출처(부모가 안을 못 만짐)');
    // 실시간
    fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('이차함수', '이차함수의 그래프').replace('</body>', '<p id="s"></p><script>localStorage.setItem("a","됨");document.getElementById("s").textContent=localStorage.getItem("a")</script></body>'));
    await sleep(3500);
    ok(await fr.locator('#t').textContent() === '이차함수의 그래프', '3 파일이 바뀌면 저절로 다시 그림');
    ok(await fr.locator('#s').textContent() === '됨', '3 저장 기능(localStorage)을 쓰는 페이지도 멈추지 않음');
    // 따라가기: 다른 파일을 쓰면 그 탭으로
    await p.evaluate(() => Canvas.onItems('sA', [{ t: 2, kind: 'tool', name: 'Edit', files: ['web\\app.js'] }], false));
    await sleep(700);
    ok(await p.locator('.cv-tab.cur').textContent() === 'app.js' && /console\.log/.test(await p.locator('.cv-code').textContent()), '3 따라가기 = 방금 쓴 파일로 이동 · 코드는 줄 번호와 글자');
    await p.locator('[data-cv="follow"]').click();
    await p.locator('.cv-tab', { hasText: '활동지.html' }).click(); await sleep(600);
    await p.evaluate(() => Canvas.onItems('sA', [{ t: 3, kind: 'tool', name: 'Edit', files: ['web\\app.js'] }], false));
    await sleep(500);
    ok(await p.locator('.cv-tab.cur').textContent() === '활동지.html' && await p.locator('.cv-tab.new').count() === 1, '3 따라가기 끔 = 그대로 · 바뀐 탭에 점');
    // 고르기 → 입력창
    await p.locator('[data-cv="pick"]').click(); await sleep(1200);
    await p.frameLocator('.cv-view iframe').locator('#c2').click(); await sleep(400);
    ok(/카드 2/.test(await p.locator('.cv-pickin').inputValue()), '3 고르기 = 누른 곳 글자가 「고칠 곳」 칸에');
    if (process.env.IRIS_CAPTURE_DIR) await p.screenshot({ path: path.join(process.env.IRIS_CAPTURE_DIR, 'canvas-pick.png') });
    await p.locator('.cv-go').click();
    const comp = await p.locator('#composer-text').inputValue();
    ok(/\[캔버스\].*활동지\.html.*「카드 2/.test(comp), `3 「이 부분 고쳐 줘」 = 입력창에 머리말(보내지는 않음)`);
    // 세션마다 따로
    await p.evaluate((w) => Canvas.onSession('sB', w), work); await sleep(300);
    ok(await p.locator('#canvas').isHidden() && (await p.locator('.cv-toggle b').textContent()) === '', '3 다른 세션 = 그 세션 것(파일 없음 · 닫힘)');
    await p.evaluate((w) => Canvas.onSession('sA', w), work); await sleep(500);
    ok(await p.locator('#canvas').isVisible() && await p.locator('.cv-tab').count() === 2, '3 돌아오면 탭 2개 그대로 · 열림 기억');
    // 닫으면 다시 저절로 열지 않음
    await p.locator('[data-cv="close"]').click();
    await p.evaluate(() => Canvas.onItems('sA', [{ t: 4, kind: 'tool', name: 'Write', files: ['web\\new.html'] }], false)); await sleep(300);
    ok(await p.locator('#canvas').isHidden() && await p.locator('.cv-toggle.fresh').count() === 1, '3 사용자가 닫았으면 다시 안 열림 · 단추에 새 표시');
    await p.keyboard.press('Control+Shift+K'); await sleep(300);
    ok(await p.locator('#canvas').isVisible(), '3 Ctrl+Shift+K = 열기');
    // 사라진 파일 · 표 · 소리
    fs.writeFileSync(path.join(work, 'web', '표.csv'), '이름,점수\n가,"1,200"\n');
    await p.evaluate(() => Canvas.onItems('sA', [{ t: 5, kind: 'tool', name: 'Write', files: ['web/표.csv'] }], false)); await sleep(900);
    if (await p.locator('.cv-table').count() === 0) { await p.locator('.cv-tab', { hasText: '표.csv' }).click(); await sleep(700); }
    ok(await p.locator('.cv-table tr').count() === 2 && await p.locator('.cv-table td').nth(3).textContent() === '1,200', '3 csv 는 표로(따옴표 속 쉼표)');
    fs.rmSync(path.join(work, 'web', '표.csv')); await p.locator('.cv-tab', { hasText: 'app.js' }).click(); await sleep(500); await p.locator('.cv-tab', { hasText: '표.csv' }).click(); await sleep(700);
    ok(/파일이 없어요/.test(await p.locator('.cv-view').innerText()), '3 사라진 파일은 안내(JSON 글자 아님)');
    fs.writeFileSync(path.join(work, 'web', '표.csv'), '다시'); await sleep(3000);
    ok(await p.locator('.cv-table').count() === 1, '3 다시 생기면 저절로 보임');
    // 좁은 창
    await p.setViewportSize({ width: 900, height: 800 }); await sleep(400);
    ok(await p.locator('#chat-wrap.cv-float').count() === 1, '3 좁은 창 = 떠 있는 창');
    ok(errs.length === 0, `3 페이지 오류 0건${errs.length ? ': ' + errs.join(' | ') : ''}`);
  }
} catch (e) { console.error(e); fail++; }
finally {
  try { await browser?.close(); } catch {}
  try { process.kill(d.pid); } catch {}
  await sleep(300);
  for (const dir of [state, mods, work]) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {} }
}
console.log(`\n${pass} PASS / ${fail} FAIL / ${skip} SKIP`);
process.exit(fail ? 1 : 0);
