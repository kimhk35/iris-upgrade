// 데몬 보안 검사(P18 점검, 2026-11-11) — 시험 데몬 3459(임시 state·자동 재개·업데이트 끔)에 "다른 웹사이트"처럼 붙어 본다.
//   ① 받는 주소(Host) 위조 = 거절(DNS 리바인딩)  ② 다른 출처의 쓰기 요청(세션 만들기·설정 저장·보내기 …) = 거절
//   ③ 다른 출처의 실시간 통로(웹소켓) = 거절, 같은 출처·Origin 없는 로컬 도구 = 통과
//   ④ /api/file: HTML 은 격리 헤더(CSP sandbox) · secrets 자리·.env 는 거절
//   실제 CLI·실제 세션 접촉 0(세션 만들기는 거절되는지만 본다).   npm run verify:security
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3459, BASE = `http://127.0.0.1:${PORT}`, SELF = `http://127.0.0.1:${PORT}`, EVIL = 'https://evil.example';
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`PASS ${n}`); } else { fail++; console.log(`FAIL ${n}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-sec-'));
const mods = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-sec-mods-'));
const files = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-sec-files-'));
fs.writeFileSync(path.join(state, 'settings.json'), JSON.stringify({ voice: { preload: false } }));
fs.writeFileSync(path.join(state, 'sessions.json'), '[]');
fs.writeFileSync(path.join(files, 'page.html'), '<!doctype html><p>hi</p>');
fs.writeFileSync(path.join(files, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
fs.writeFileSync(path.join(files, 'note.txt'), 'hello');
fs.mkdirSync(path.join(files, 'secrets')); fs.writeFileSync(path.join(files, 'secrets', 'iris-cli-token.json'), '{"token":"x"}');
fs.writeFileSync(path.join(files, '.env.json'), '{}');

const d = spawn(process.execPath, [path.join(ROOT, 'daemon', 'server.mjs')], { cwd: ROOT, windowsHide: true, stdio: 'ignore',
  env: { ...process.env, IRIS_FACE_PORT: String(PORT), IRIS_FACE_STATE: state, IRIS_FACE_MODULES: mods, IRIS_FACE_AUTO_RESUME: '0', IRIS_FACE_UPDATE_CHECK: '0' } });
const req = (p, { method = 'GET', headers = {}, body } = {}) => fetch(BASE + p, { method, headers, body, redirect: 'manual' });
const wsTry = (headers) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers });
  const t = setTimeout(() => { try { ws.terminate(); } catch {} resolve('timeout'); }, 4000);
  ws.on('message', (m) => { clearTimeout(t); let type = ''; try { type = JSON.parse(m).type; } catch {} ws.close(); resolve(type === 'hello' ? 'open' : 'other'); });
  ws.on('unexpected-response', (_q, r) => { clearTimeout(t); resolve(`http ${r.statusCode}`); });
  ws.on('error', () => { clearTimeout(t); resolve('error'); });
});

try {
  let up = false; for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await req('/api/health')).ok; } catch {} }
  ok(up, `시험 데몬 ${PORT} pid=${d.pid}`);

  // ① Host
  // fetch 는 Host 머리글을 바꿔 보내지 못하므로(보안상 무시) http.request 로 직접 보낸다
  const rawStatus = (host, p = '/api/health') => new Promise((resolve) => { const q = http.request({ host: '127.0.0.1', port: PORT, path: p, headers: { host } }, (r) => { r.resume(); resolve(r.statusCode); }); q.on('error', () => resolve(0)); q.end(); });
  ok(await rawStatus(`evil.example:${PORT}`) === 403, 'Host 위조(DNS 리바인딩) = 403');
  ok(await rawStatus(`evil.example:${PORT}`, `/api/file?path=${encodeURIComponent(path.join(files, 'note.txt'))}`) === 403, 'Host 위조로 파일 읽기 = 403');
  ok((await req('/api/health', { headers: { host: `localhost:${PORT}` } })).status === 200, 'Host localhost = 통과');
  ok((await req('/')).status === 200, '화면(/) = 통과');

  // ② 쓰기 요청 — 예전엔 세션 만들기·설정 저장·보내기에 검사가 없었다
  const evilJson = { origin: EVIL, 'content-type': 'text/plain' }; // 남의 사이트가 보낼 수 있는 모양(사전 확인 없는 단순 요청)
  for (const [m, p, b] of [['POST', '/api/sessions', { cwd: files, agent: 'claude' }], ['PUT', '/api/settings', { theme: 'black' }], ['POST', '/api/sessions/s1/send', { text: 'calc' }], ['POST', '/api/shutdown', {}], ['POST', '/api/open', { path: files }], ['POST', '/api/upload', {}]]) {
    const r = await req(p, { method: m, headers: evilJson, body: JSON.stringify(b) });
    ok(r.status === 403, `다른 출처 ${m} ${p} = 403 (받음 ${r.status})`);
  }
  const sf = await req('/api/settings', { method: 'PUT', headers: { origin: EVIL, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: '{"theme":"black"}' });
  ok(sf.status === 403, 'Sec-Fetch-Site cross-site 쓰기 = 403');
  ok((await (await req('/api/settings')).json()).theme !== 'black', '거절된 설정 저장은 실제로 바뀌지 않음');
  const same = await req('/api/settings', { method: 'PUT', headers: { origin: SELF, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: '{"theme":"forest"}' });
  ok(same.status === 200 && (await (await req('/api/settings')).json()).theme === 'forest', '같은 출처 설정 저장 = 통과(화면 기능 그대로)');
  const tool = await req('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"theme":"indigo"}' });
  ok(tool.status === 200, 'Origin 없는 로컬 도구 쓰기 = 통과(실행기·적용기)');

  // ③ 웹소켓
  ok(await wsTry({ origin: EVIL }) === 'http 401', `다른 출처 웹소켓 = 거절`);
  ok(await wsTry({ origin: SELF }) === 'open', '같은 출처 웹소켓 = 열림');
  ok(await wsTry({}) === 'open', 'Origin 없는 로컬 웹소켓(검사 도구) = 열림');
  ok(await wsTry({ origin: SELF, host: `evil.example:${PORT}` }) === 'http 401', 'Host 위조 웹소켓 = 거절');

  // ④ /api/file
  const fq = (f) => `/api/file?path=${encodeURIComponent(path.join(files, f))}`;
  const h = await req(fq('page.html'));
  ok(h.status === 200 && /sandbox allow-scripts/.test(h.headers.get('content-security-policy') || '') && !/allow-same-origin/.test(h.headers.get('content-security-policy') || ''), 'HTML 미리보기 = 격리 헤더(같은 출처 권한 없음)');
  ok(/sandbox/.test((await req(fq('pic.svg'))).headers.get('content-security-policy') || ''), 'SVG 미리보기 = 격리 헤더');
  const t = await req(fq('note.txt')); ok(t.status === 200 && !t.headers.get('content-security-policy'), '글자 파일 = 그대로');
  ok((await req(fq('secrets/iris-cli-token.json'))).status === 403, 'secrets 자리 파일 = 403');
  ok((await req(fq('.env.json'))).status === 403, '.env 파일 = 403');
} catch (e) { console.error(e); fail++; }
finally {
  try { process.kill(d.pid); } catch {}
  await sleep(300);
  for (const dir of [state, mods, files]) fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
