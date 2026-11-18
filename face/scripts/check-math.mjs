// 대화 화면 수식 검사(P18, 2026-11-12) — 시험 데몬 3459 + 헤드리스 브라우저. KaTeX 는 동봉본(app/vendor/katex)만, 바깥 요청 0.
//   npm run verify:math   (playwright 없으면 SKIP)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3459, BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`PASS ${n}`); } else { fail++; console.log(`FAIL ${n}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const req = createRequire(import.meta.url);
let pw = null; for (const c of ['playwright', path.join(process.env.APPDATA || '', 'npm/node_modules/playwright')]) { try { pw = req(c); break; } catch {} }
if (!pw) { console.log('SKIP: playwright 없음'); process.exit(0); }

const state = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-math-')), mods = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-math-m-'));
fs.writeFileSync(path.join(state, 'settings.json'), JSON.stringify({ voice: { preload: false }, intro: false })); fs.writeFileSync(path.join(state, 'sessions.json'), '[]');
const d = spawn(process.execPath, [path.join(ROOT, 'daemon', 'server.mjs')], { cwd: ROOT, windowsHide: true, stdio: 'ignore', env: { ...process.env, IRIS_FACE_PORT: String(PORT), IRIS_FACE_STATE: state, IRIS_FACE_MODULES: mods, IRIS_FACE_AUTO_RESUME: '0', IRIS_FACE_UPDATE_CHECK: '0' } });
let browser;
try {
  for (let i = 0; i < 60; i++) { await sleep(250); try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} }
  browser = await pw.chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const outside = []; p.on('request', (r) => { if (!r.url().startsWith(BASE)) outside.push(r.url()); });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE); await sleep(1200);
  const text = [
    '이차방정식의 근의 공식은 $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$ 입니다.',
    '',
    '$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$',
    '',
    '곱 표시 $a*b*c$ 는 기울임이 되면 안 됩니다. 글 안 \\(e^{i\\pi}+1=0\\) 도 됩니다.',
    '',
    '가격은 $5 이고 할인가는 $3 입니다. 변수 $x$ 하나.',
    '',
    '```',
    'echo $HOME $$ $x$',
    '```',
    '`$y$ 코드`',
  ].join('\n');
  await p.evaluate((t) => { document.querySelector('#view').hidden = false; Transcript.render([{ t: 1, kind: 'user', text: '수식 보여 줘' }, { t: 2, kind: 'assistant', text: t }], {}); }, text);
  await sleep(500);
  const r = await p.evaluate(() => {
    const a = [...document.querySelectorAll('#chat .step-text, #chat .bubble')].pop();
    return { katex: a.querySelectorAll('.katex').length, display: a.querySelectorAll('.katex-display').length, italic: a.querySelectorAll('i').length, html: a.innerHTML, text: a.innerText };
  });
  ok(r.katex === 5, `수식 5개가 KaTeX 로(근의 공식·적분·a*b*c·오일러·x) (${r.katex})`);
  ok(r.display === 1, '$$…$$ 는 가운데 큰 수식');
  ok(r.italic === 0, '수식 속 * 가 기울임으로 바뀌지 않음');
  ok(/가격은 \$5 이고 할인가는 \$3 입니다/.test(r.text), '돈 표기 $5 · $3 은 글자 그대로');
  ok(/echo \$HOME \$\$ \$x\$/.test(r.text) && /\$y\$ 코드/.test(r.text), '코드 블록·`코드` 안은 그대로');
  const font = await p.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some((f) => /KaTeX/.test(f.family) && f.status === 'loaded'); });
  ok(font, 'KaTeX 글꼴이 동봉본에서 읽힘');
  ok(outside.length === 0, `바깥 인터넷 요청 0건${outside.length ? ': ' + outside.join(' ') : ''}`);
  if (process.env.IRIS_CAPTURE_DIR) await p.screenshot({ path: path.join(process.env.IRIS_CAPTURE_DIR, 'math.png') });
  ok(errs.length === 0, `페이지 오류 0${errs.length ? ': ' + errs.join(' | ') : ''}`);
} catch (e) { console.error(e); fail++; }
finally { try { await browser?.close(); } catch {} try { process.kill(d.pid); } catch {} await sleep(300); for (const x of [state, mods]) fs.rmSync(x, { recursive: true, force: true }); }
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
