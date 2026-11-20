// 설명서 화면 캡처: 시험 데몬(3459, 임시 영혼) + 웹소켓·기록 흉내(가짜 세션, 실제 CLI·세션 접촉 0) → 번호 표 얹어 manual/img/shot-*.png
// 바탕 = face/scripts/capture-tutorial-usage.mjs. 사용: node manual/scripts/capture.mjs [이름 ...]
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process'; import { createRequire } from 'node:module'; import { pathToFileURL, fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const P18 = path.resolve(HERE, '..', '..'); const ROOT = path.join(P18, 'face'); const OUT = path.join(P18, 'manual', 'shots-src'); // 원본 PNG → scripts/towebp.py 가 img/*.webp 로
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const { parseApproval } = await import(pathToFileURL(path.join(ROOT, 'daemon', 'approval.mjs')).href);
const PW = process.env.PLAYWRIGHT_CORE || path.resolve(P18, '..', 'P04-게임존(Game Zone)', 'node_modules', 'playwright-core');
const { chromium } = createRequire(import.meta.url)(PW);
const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium_headless_shell-1248', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-manual-'));
const soul = path.join(tmp, 'IRIS'); const state = path.join(tmp, 'st'); const mods = path.join(tmp, 'm');
const cwdP = path.join(soul, 'R01-교사(Teacher)', 'D01-수업(Teaching)', 'P01-물리학 〖2026년.2학기〗');
for (const d of [soul, state, mods, cwdP]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(state, 'settings.json'), JSON.stringify({ voice: { preload: false }, intro: false }));
fs.writeFileSync(path.join(state, 'sessions.json'), '[]');
fs.writeFileSync(path.join(state, 'tutorial.json'), JSON.stringify({ done: true }));
// 캔버스에 띄울 견본 학습지(AI 가 만든 파일 흉내)
const sheet = path.join(cwdP, '운동량 보존 학습지.html');
fs.writeFileSync(sheet, `<!doctype html><meta charset="utf-8"><style>body{font-family:'Malgun Gothic',sans-serif;margin:28px;color:#1d2433;background:#fffdf7}h1{font-size:22px;border-bottom:3px solid #e6a23c;padding-bottom:6px}
.q{border:1px solid #e3dccb;border-radius:10px;padding:12px 14px;margin:12px 0;background:#fff}.q b{color:#c0712a}.box{height:46px;border:1px dashed #c9c2b2;border-radius:6px;margin-top:8px}
.tag{display:inline-block;background:#eef3ff;color:#3b5bdb;border-radius:20px;padding:2px 10px;font-size:12px;margin-right:6px}</style>
<h1>운동량 보존 — 수레 충돌 실험 학습지</h1><p><span class="tag">물리학</span><span class="tag">2학년</span><span class="tag">40분</span></p>
<div class="q"><b>1.</b> 질량 1kg 수레가 2m/s 로 정지한 1kg 수레에 부딪혀 함께 움직인다. 충돌 뒤 속력은?<div class="box"></div></div>
<div class="q"><b>2.</b> 충돌 전후 운동 에너지를 비교하고, 줄어든 에너지는 어디로 갔는지 써 보자.<div class="box"></div></div>
<div class="q"><b>3.</b> 실험에서 측정 오차가 생기는 까닭을 두 가지 들어 보자.<div class="box"></div></div>`);

const PORT = 3459;
const d = spawn(process.execPath, [path.join(ROOT, 'daemon', 'server.mjs')], { cwd: ROOT, windowsHide: true, stdio: 'ignore',
  env: { ...process.env, IRIS_ROOT: soul, IRIS_FACE_PORT: String(PORT), IRIS_FACE_STATE: state, IRIS_FACE_MODULES: mods, IRIS_FACE_AUTO_RESUME: '0', IRIS_FACE_UPDATE_CHECK: '0', IRIS_FACE_GEMINI_USAGE: '0', IRIS_AGENTS_HOME: tmp, CLAUDE_CONFIG_DIR: path.join(soul, '_agent', 'claude'), CODEX_HOME: path.join(soul, '_agent', 'codex') } });

const D = '─'.repeat(120);
const prompt = parseApproval([D, ' ☐ 분량', '세특 초안을 어떤 길이로 쓸까요?', '❯ 1. 500자 안팎', '     학교에서 정한 기본 분량', '  2. 300자 안팎', '     핵심만 짧게', '  3. Type something.', D, '  4. Chat about this', 'Enter to select · ↑/↓ to navigate · Esc to cancel'].join('\n'));
const now = Date.now();
const S = [
  { id: 'a1', cwd: cwdP, agent: 'claude', model: 'opus', effort: 'high', status: 'attention', title: '물리학 세특 초안 쓰기', titleSource: 'user', pid: 1, createdAt: now - 600000, prompt, pinned: true },
  { id: 'a4', cwd: cwdP, agent: 'claude', model: 'opus', effort: 'high', status: 'idle', title: '운동량 보존 학습지 만들기', titleSource: 'ai', pid: 4, createdAt: now - 900000 },
  { id: 'a5', cwd: cwdP, agent: 'gemini', model: 'Gemini 4 Argon (Medium)', status: 'idle', title: '포물선 운동 수식 풀이', titleSource: 'ai', pid: 5, createdAt: now - 1000000 },
  { id: 'a2', cwd: cwdP, agent: 'codex', model: 'gpt-5.5', effort: 'medium', status: 'busy', title: '수행평가 채점 기준표 정리', titleSource: 'ai', pid: 2, createdAt: now - 1200000 },
  { id: 'a3', cwd: soul, agent: 'claude', model: 'sonnet', effort: 'medium', status: 'idle', title: '가정통신문 초안', titleSource: 'ai', pid: 3, createdAt: now - 3600000 },
];
const T = new Date(now - 300000).toISOString();
const TR = {
  a1: [
    { i: 1, t: T, kind: 'user', text: '이 폴더의 작년 세특 예시를 참고해서 3반 학생들 물리학 세특 초안을 써 줘.' },
    { i: 2, t: T, kind: 'tool', name: 'Read', detail: '작년 세특 예시.hwpx' },
    { i: 3, t: T, kind: 'tool', name: 'Read', detail: '3반 수행평가 결과.xlsx' },
    { i: 4, t: T, kind: 'assistant', text: '작년 예시 12건과 3반 수행평가 결과 28명분을 읽었습니다. 예시는 **한 문장에 한 활동**, 500자 안팎으로 쓰여 있습니다.\n\n쓰기 전에 분량을 한 가지만 확인하겠습니다.' },
  ],
  a4: [
    { i: 1, t: T, kind: 'user', text: '수레 충돌 실험으로 운동량 보존 학습지를 한 장 만들어 줘. 문제 3개면 돼.' },
    { i: 2, t: T, kind: 'tool', name: 'Write', detail: '운동량 보존 학습지.html', files: [sheet] },
    { i: 3, t: T, kind: 'assistant', text: '학습지를 만들었습니다. 오른쪽 **캔버스**에서 바로 볼 수 있어요.\n\n- 1번: 완전 비탄성 충돌 속력 계산\n- 2번: 운동 에너지 비교\n- 3번: 측정 오차의 까닭\n\n고치고 싶은 부분을 캔버스에서 골라 「이 부분 고쳐 줘」를 눌러 주세요.' },
  ],
  a5: [
    { i: 1, t: T, kind: 'user', text: '수평으로 던진 공의 궤적이 포물선인 까닭을 수식으로 보여 줘.' },
    { i: 2, t: T, kind: 'assistant', text: '수평 방향은 등속, 연직 방향은 등가속 운동입니다.\n\n$$x = v_0 t, \\qquad y = \\frac{1}{2} g t^2$$\n\n첫 식에서 $t = \\dfrac{x}{v_0}$ 를 둘째 식에 넣으면\n\n$$y = \\frac{g}{2 v_0^{2}}\\, x^{2}$$\n\n이 되어, $y$ 가 $x^2$ 에 비례하는 **포물선**이 됩니다.' },
  ],
};

// 번호 표 얹기: [선택자, dx, dy, 모서리]
const MARK = (list) => (marks) => {
  const at = (sel, dx, dy, corner = 'tl') => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width) return null; const x = corner.includes('r') ? r.right : r.left; const y = corner.includes('b') ? r.bottom : r.top; return [x + dx, y + dy]; };
  const out = [];
  marks.forEach(([sel, dx, dy, c], i) => { const pt = at(sel, dx, dy, c); out.push(pt ? 1 : 0); if (!pt) return; const b = document.createElement('div'); b.className = 'mk-num'; b.textContent = String(i + 1);
    b.style.cssText = `position:fixed;left:${pt[0] - 17}px;top:${pt[1] - 17}px;width:34px;height:34px;border-radius:50%;background:#f2b56b;color:#1a1408;font:800 19px/34px "Segoe UI",sans-serif;text-align:center;z-index:99999;box-shadow:0 0 0 3px rgba(0,0,0,.45),0 4px 14px rgba(0,0,0,.5)`; document.body.appendChild(b); });
  return out;
};
const clearMarks = () => document.querySelectorAll('.mk-num').forEach(e => e.remove());

let browser;
try {
  for (let i = 0; i < 60; i++) { await sleep(250); try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch {} }
  browser = await chromium.launch({ executablePath: EXE });
  const newPage = async ({ theme, sessions = S } = {}) => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 880 }, deviceScaleFactor: 2 });
    if (theme) await p.addInitScript((t) => { try { localStorage.setItem('iris.manual.theme', t); } catch {} }, theme);
    await p.routeWebSocket('**/ws', (ws) => {
      const srv = ws.connectToServer();
      srv.onMessage((m) => { try { const o = JSON.parse(m); if (o.type === 'hello') { o.sessions = sessions; o.handoff = null; ws.send(JSON.stringify(o)); return; } if (o.type === 'sessions') return; } catch {} ws.send(m); });
      ws.onMessage((m) => { try { if (JSON.parse(m).type === 'attach') return; } catch {} srv.send(m); });
    });
    for (const [id, items] of Object.entries(TR)) await p.route(`**/api/sessions/${id}/transcript*`, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, meta: {} }) }));
    await p.goto(`http://127.0.0.1:${PORT}/`); await sleep(1800);
    await p.evaluate(() => { const s = document.querySelector('#sig'); if (s) s.style.display = 'none'; const i = document.querySelector('#intro'); if (i) i.style.display = 'none'; });
    return p;
  };
  const open = async (p, title) => { await p.locator('#session-list').getByText(title).first().click(); await sleep(1500); };
  const shot = async (p, name, marks = []) => {
    if (only.length && !only.includes(name)) return;
    await p.evaluate(clearMarks);
    const ok = await p.evaluate(MARK(), marks);
    await sleep(200); await p.screenshot({ path: path.join(OUT, `shot-${name}.png`) });
    console.log(name, ok.join(''));
  };
  const theme = async (p, id) => { await p.evaluate((t) => { Settings.show('design'); }, id); await sleep(400); await p.locator(`#st-themes [data-theme="${id}"]`).click(); await sleep(300); await p.evaluate(() => Settings.hide()); await sleep(500); };

  // 1) 처음 화면(빈 작업목록)
  let p = await newPage({ sessions: [] });
  await shot(p, 'home', [['#btn-rail', 18, 44], ['#btn-home', -4, 2], ['#btn-folder', -6, -8], ['#ag-claude', -6, -8], ['#sel-model', -6, -8], ['#sel-effort', -6, -8], ['#composer', 10, 8], ['#btn-mic', 0, -10], ['#mem', 0, 34], ['#local-usage', 6, 34], ['#btn-settings', 4, 46]]);
  await p.close();

  // 2) 대화 + 확인 카드 · 3) 수식 · 4) 캔버스 · 5) 줄 메뉴
  p = await newPage();
  await open(p, '물리학 세특 초안 쓰기');
  await p.locator('#composer-text').fill('2반도 같은 방식으로 이어서 써 줘');
  await shot(p, 'chat', [['#session-list', 12, 6], ['#vh-title', -6, -6], ['#approval', 8, 8], ['#btn-mode-chat', -4, -4], ['#composer', 8, 6]]);
  await p.locator('#composer-text').fill('');
  await open(p, '포물선 운동 수식 풀이');
  await shot(p, 'math', []);
  await open(p, '운동량 보존 학습지 만들기'); await sleep(1500);
  await shot(p, 'canvas', [['.cv-tabs', 6, 4], ['[data-cv="follow"]', -4, -6]]);
  await p.locator('#session-list').getByText('수행평가 채점 기준표 정리').first().click({ button: 'right' }); await sleep(600);
  await shot(p, 'rowmenu', []);
  await p.keyboard.press('Escape'); await sleep(300);

  // 6) 설정 묶음
  for (const pane of ['design', 'session', 'tools', 'account', 'about']) {
    await p.evaluate((x) => Settings.show(x), pane); await sleep(900);
    if (pane === 'tools') { const b = p.locator('#st-tools').getByText('MCP', { exact: false }).first(); try { await b.click({ timeout: 1500 }); await sleep(700); } catch {} }
    await shot(p, `set-${pane}`, []);
  }
  await p.evaluate(() => Settings.hide()); await sleep(400);

  // 7) 밝은 테마
  await theme(p, 'paper'); await open(p, '포물선 운동 수식 풀이');
  await shot(p, 'light', []);
  await theme(p, 'indigo');

  // 9) 계정 공유(4명) — 작은 창 · 말풍선 · 설정 칸. 사용률은 가짜 값(데몬 share.mjs 모양)
  if (!only.length || only.some((x) => x.startsWith('share'))) {
    await p.route('**/api/usage/share', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ anthropic: { mineWeek: 0.18, mine5h: 0.12, accountWeek: 0.52, account5h: 0.31 }, codex: { mineWeek: 0.21, mine5h: 0.26, accountWeek: 0.64, account5h: 0.4 } }) }));
    await p.evaluate(() => Settings.setSharePeople(4)); await p.evaluate(() => document.dispatchEvent(new CustomEvent('iris:cfg-change')));
    await p.evaluate(async () => { const r = await fetch('/api/usage/share'); return r.ok; }); await sleep(300);
    await p.reload(); await sleep(2500);
    await p.locator('#local-usage').click(); await sleep(600);
    await shot(p, 'share', []);
    await p.locator('#team-pop .tip-i').first().hover(); await sleep(400);
    await shot(p, 'share-tip', []);
    await p.keyboard.press('Escape'); await sleep(300);
    await p.evaluate(() => Settings.show('account')); await sleep(700);
    await p.evaluate(() => document.querySelector('.st-team')?.scrollIntoView({ block: 'center' })); await sleep(300);
    await p.locator('.st-team .tip-i').first().hover(); await sleep(400);
    await shot(p, 'share-set', []);
    await p.evaluate(() => Settings.hide()); await sleep(400);
    await p.locator('#dock-usage').click(); await sleep(600);
    await shot(p, 'share-dock', []);
    await p.keyboard.press('Escape'); await sleep(200);
    await p.evaluate(() => { Settings.setSharePeople(1); });
  }

  // 11) 인터뷰 안내 띠 — 내 작업 폴더가 없을 때 첫 화면(가짜로 「폴더 없음」), × 누르면 사라지고 다시 안 뜸
  if (only.includes('ivhint')) {
    const q = await newPage({ sessions: [] });
    await q.route('**/api/tutorial/existing', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ roles: [] }) }));
    await q.evaluate(() => { try { localStorage.removeItem('iris.ivHint.off'); } catch {} }); await q.reload(); await sleep(2500);
    const before = await q.locator('#iv-hint').isVisible();
    await shot(q, 'ivhint', []);
    await q.locator('#iv-hint [data-iv="x"]').click(); await sleep(300);
    const after = await q.locator('#iv-hint').isVisible();
    await q.reload(); await sleep(2500);
    console.log('ivhint 처음', before, '× 뒤', after, '다시 켠 뒤', await q.locator('#iv-hint').isVisible());
    await q.close();
  }

  // 10) 폴더 만들기 인터뷰 — 설정 단추 → 입력창에 인터뷰 요청문(보내기는 사용자)
  if (!only.length || only.includes('interview')) {
    await p.evaluate(() => Settings.show('about')); await sleep(600);
    await p.locator('#st-interview').click(); await sleep(1500);
    const v = await p.locator('#composer-text').inputValue();
    console.log('interview 입력창', v.startsWith('나의 삶을 인터뷰') ? '채워짐' : '비어 있음', v.length, '자');
    await shot(p, 'interview', []);
    await p.locator('#composer-text').fill('');
  }

  // 8) 확인용: IRIS 안 사용 설명서 서랍 · 정보 창(Developer)
  if (!only.length || only.includes('drawer') || only.includes('about')) {
    await p.evaluate(() => Settings.show('about')); await sleep(600);
    await p.locator('#st-manual').click(); await sleep(2500);
    await shot(p, 'drawer', []);
    await p.locator('#dash-close').click(); await sleep(500);
    await p.evaluate(() => Settings.show('about')); await sleep(500);
    await p.locator('#maker').click(); await sleep(800);
    await shot(p, 'about', []);
  }
  await p.close();
} finally { try { await browser?.close(); } catch {} try { process.kill(d.pid); } catch {} }
