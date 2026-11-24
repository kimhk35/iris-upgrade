// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// docpages.mjs — 변환된 PDF(doc2pdf.mjs) → 쪽 그림. 캔버스의 슬라이드·종이 보기가 쓴다(P18 2026-11-24 "왜 다 pdf처럼 열리지?").
// 결과 = <PDF 이름>.pages\{info.json, pN.jpg, hashes.json}. 앞쪽부터 한 쪽씩 생기므로 긴 문서도 첫 쪽은 바로 보인다.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pyCandidates } from './doc2pdf.mjs';

const PY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docpages.py');
const jobs = new Map(); // id → { dir, done:Promise<true|Error>, ended }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
export const ID_RE = /^[0-9a-f]{16}$/;
export const idOf = (pdf) => path.basename(pdf).slice(0, 16);

function run(py, pdf, dir) {
  const [exe, script] = Array.isArray(py) ? py : [py, PY];
  return new Promise((resolve) => {
    let err = '';
    const c = spawn(exe, [script, pdf, dir], { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
    const timer = setTimeout(() => { try { c.kill(); } catch {} }, 300_000);
    c.stdout?.resume(); c.stderr?.on('data', (d) => { err += d; });
    c.on('error', (e) => { clearTimeout(timer); resolve({ code: 'ENOENT', err: e.message }); });
    c.on('close', (code) => { clearTimeout(timer); resolve({ code, err }); });
  });
}

/** PDF 의 쪽 그림 만들기를 시작(이미 했거나 하는 중이면 그대로)하고 { id, n, sizes } 를 준다. 못 그리면 throw(호출부는 PDF 로 보여 줌). */
export async function openPages(pdf, log = () => {}, opts = {}) {
  const id = idOf(pdf); const dir = `${pdf.slice(0, -4)}.pages`;
  let job = jobs.get(id);
  if (!job || (job.ended && !fs.existsSync(path.join(dir, 'hashes.json')))) {
    job = { dir, ended: fs.existsSync(path.join(dir, 'hashes.json')), error: null }; jobs.set(id, job);
    if (!job.ended) (async () => {
      const t0 = Date.now(); job.error = 'NOPY';
      for (const py of opts.candidates || pyCandidates('office')) {
        const r = await run(py, pdf, dir);
        if (r.code === 0) { job.error = null; log(`docpages ${((Date.now() - t0) / 1000).toFixed(1)}s ${path.basename(pdf)}`); break; }
        if (r.code === 3 || r.code === 'ENOENT') continue;
        job.error = 'FAIL'; log(`docpages FAIL ${path.basename(pdf)}: ${String(r.err).trim().split('\n').pop()}`); break;
      }
      job.ended = true;
    })();
  }
  for (;;) {
    const info = readJson(path.join(dir, 'info.json'));
    if (info) return { id, ...info };
    if (job.ended) throw new Error('쪽 그림을 만들지 못했습니다');
    await sleep(60);
  }
}
/** 그 쪽 그림 파일(생길 때까지 기다림). 없으면 null. */
export async function pageFile(id, n, waitMs = 60_000) {
  const job = jobs.get(id); if (!job) return null;
  const f = path.join(job.dir, `p${n}.jpg`);
  for (let t = 0; t < waitMs; t += 80) { if (fs.existsSync(f)) return f; if (job.ended) return fs.existsSync(f) ? f : null; await sleep(80); }
  return null;
}
/** 그 쪽의 글자 줄 [[왼쪽,위,오른쪽,아래, 글]] — 없으면 빈 목록. */
export async function pageText(id, n) { return (await pageFile(id, n, 8000)) ? readJson(path.join(jobs.get(id).dir, `p${n}.json`)) || [] : []; }
/** 쪽마다의 지문(다 그린 뒤) — 「바뀜」 표시용. 실패하면 null. */
export async function pageHashes(id) {
  const job = jobs.get(id); if (!job) return null;
  while (!job.ended) await sleep(120);
  return readJson(path.join(job.dir, 'hashes.json'));
}
/** 오래된 변환 결과 정리(기본 14일) — 우리가 만든 캐시만. */
export function sweepCache(cacheDir, days = 14, now = Date.now()) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(cacheDir, { withFileTypes: true })) {
      if (!/^[0-9a-f]{16}-.+\.(pdf|pages)$/.test(e.name)) continue;
      const p = path.join(cacheDir, e.name);
      try { if (now - fs.statSync(p).mtimeMs > days * 86400000) { fs.rmSync(p, { recursive: true, force: true }); n++; } } catch {}
    }
  } catch {}
  return n;
}
