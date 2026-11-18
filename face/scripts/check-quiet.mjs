// 검사: 끝난 대화는 안 읽기 · 데몬 기록 1MB 넘기기(C4) · 같은 이름 첨부·설정 안전 저장(C5) — P18, 2026-11-18 점검.
// 시험 데몬(3459, 임시 state)만 띄운다 — 실 데몬(3458)·실 CLI 접촉 0. npm run verify:quiet
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3459;

// 1) 정적: 끝난 대화는 한 번 읽은 뒤 화면이 열어 둘 때만
const src = fs.readFileSync(path.join(ROOT, 'daemon', 'server.mjs'), 'utf8');
const loop = src.slice(src.indexOf('setInterval(() => {\n  const now = Date.now();'), src.indexOf('}, POLL_FAST_MS);'));
ok(/!sm\.live\.has\(rec\.id\) && !\[\.\.\.clients\]\.some\(\(c\) => c\.attached === rec\.id\)\) continue;/.test(loop), '끝난 대화 = 한 번 읽은 뒤에는 화면이 열어 둘 때만 읽음');
ok(loop.indexOf('!sm.live.has(rec.id)') < loop.indexOf('pumpTail(rec)'), '건너뛰기는 읽기 전에');

// 2) 실제: 1MB 넘는 daemon.log 를 둔 임시 state 로 시험 데몬을 띄우면 .1 로 넘기고 새로 시작
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-quiet-'));
const mods = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-quiet-mods-'));
const big = Buffer.alloc(1024 * 1024 + 4096, 'x');
fs.writeFileSync(path.join(state, 'daemon.log'), big);
const d = spawn(process.execPath, [path.join(ROOT, 'daemon', 'server.mjs')], { cwd: ROOT, windowsHide: true, stdio: 'ignore',
  env: { ...process.env, IRIS_FACE_PORT: String(PORT), IRIS_FACE_STATE: state, IRIS_FACE_MODULES: mods, IRIS_FACE_AUTO_RESUME: '0', IRIS_FACE_UPDATE_CHECK: '0' } });
const health = () => new Promise((res) => {
  const r = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 2000 }, (x) => { x.resume(); res(x.statusCode === 200); });
  r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); });
});
try {
  let up = false; for (let i = 0; i < 80 && !up; i++) { await sleep(250); up = await health(); }
  ok(up, '시험 데몬(3459)이 뜸 — 바뀐 기록 함수로도 시작함');
  const rotated = path.join(state, 'daemon.log.1');
  ok(fs.existsSync(rotated) && fs.statSync(rotated).size === big.length, '1MB 넘은 기록은 daemon.log.1 로 넘김(내용 그대로)');
  const now = fs.statSync(path.join(state, 'daemon.log')).size;
  ok(now > 0 && now < 200 * 1024, `새 daemon.log 는 작게 다시 시작 (${now} bytes)`);

  // 3) C5: 같은 이름 첨부를 곧바로 두 번 올려도 둘 다 남는다 · 설정은 임시 파일→이름 바꾸기
  const upload = (body) => new Promise((res) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/upload', method: 'POST',
      headers: { Origin: `http://127.0.0.1:${PORT}`, 'x-file-name': encodeURIComponent('사진.png'), 'content-type': 'application/octet-stream' } }, (x) => {
      let b = ''; x.on('data', (d) => { b += d; }); x.on('end', () => { try { res(JSON.parse(b)); } catch { res(null); } });
    });
    r.on('error', () => res(null)); r.end(body);
  });
  const [u1, u2] = await Promise.all([upload('first'), upload('second')]);
  ok(u1?.path && u2?.path && u1.path !== u2.path, '같은 이름 첨부 두 번 = 서로 다른 파일');
  ok(u1?.path && u2?.path && fs.readFileSync(u1.path, 'utf8') !== fs.readFileSync(u2.path, 'utf8'), '앞 파일이 덮이지 않음(내용이 각각 남음)');
  const put = await new Promise((res) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/settings', method: 'PUT',
      headers: { Origin: `http://127.0.0.1:${PORT}`, 'content-type': 'application/json' } }, (x) => { x.resume(); x.on('end', () => res(x.statusCode)); });
    r.on('error', () => res(0)); r.end(JSON.stringify({ quietCheck: true }));
  });
  const sjson = path.join(state, 'settings.json');
  ok(put === 200 && JSON.parse(fs.readFileSync(sjson, 'utf8')).quietCheck === true && !fs.existsSync(`${sjson}.tmp`), '설정 저장 = 온전한 파일, 임시 파일 남지 않음');
} finally {
  try { d.kill(); } catch {}
  await sleep(500);
  for (const p of [state, mods]) try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
