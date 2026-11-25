// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// doc2pdf.mjs — 문서(한/글·워드·엑셀·PPT)를 PDF로 변환해 캐시에 두고 그 경로를 돌려준다.
// 데몬은 순수 node 라 COM 을 직접 못 부른다 → 파이썬(doc2pdf.py)을 자식으로 띄운다.
// 파이썬 찾기(P18 2026-11-24 신고 "캔버스 PPT 조회가 이상함 · 워드·hwpx 도"): 예전에는 오피스 = PATH 의 `python`, 한/글 = 옛 폴더만 봐서
// **설치본에서는 셋 다 안 됐다**(PATH 에 파이썬이 없음 = spawn python ENOENT). 설치기가 만드는 문서용 파이썬
// `<영혼>\_agent\runtime\venvs\document-mcp`(pywin32·pyhwpx 동봉)를 먼저 쓰고, 없거나 모듈이 빠졌으면 다음 후보로 넘어간다.
// 변환은 원본의 사본을 읽기 전용으로만 열고 새 PDF 를 만든다. 실패하면 한국어 이유로 throw → 호출부가 안내로 대체.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { soulRoot, toolPath, pythonExe } from './paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = path.join(HERE, 'doc2pdf.py');

export const DOC_EXTS = ['.hwp', '.hwpx', '.doc', '.docx', '.rtf', '.odt', '.xls', '.xlsx', '.xlsm', '.ods', '.ppt', '.pptx', '.odp'];

function hwpPyCandidatesFromSharedTools() {
  const base = toolPath('document-mcp', 'hwp');
  const found = [];
  try {
    for (const sub of fs.readdirSync(base, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const subDir = path.join(base, sub.name);
      found.push(path.join(subDir, '.venv', 'Scripts', 'python.exe'));
      found.push(path.join(subDir, 'hwp-form-automation-mcp', '.venv', 'Scripts', 'python.exe'));
    }
  } catch {}
  return found;
}

/** 설치기가 만드는 문서용 파이썬 — installer/setup/venv.mjs · adapters.mjs venvPythonPath 와 같은 자리. */
export const docVenvPython = () => path.join(soulRoot(), '_agent', 'runtime', 'venvs', 'document-mcp', 'Scripts', 'python.exe');

/** 써 볼 파이썬들(있는 것만, 앞에서부터). kind = 'hwp' | 'office'. 환경변수(IRIS_FACE_HWP_PY·IRIS_FACE_PY)가 가장 먼저. */
export function pyCandidates(kind) {
  const env = kind === 'hwp' ? [process.env.IRIS_FACE_HWP_PY, process.env.IRIS_FACE_PY] : [process.env.IRIS_FACE_PY];
  const list = [...env, docVenvPython(), ...hwpPyCandidatesFromSharedTools(), pythonExe()].filter(Boolean);
  return [...new Set(list)].filter((c) => { try { return fs.existsSync(c); } catch { return false; } });
}

const appOf = (ext) => (/^\.hwpx?$/.test(ext) ? ['한/글', '이'] : /^\.(docx?|rtf|odt)$/.test(ext) ? ['워드', '가'] : /^\.(xls[xm]?|ods)$/.test(ext) ? ['엑셀', '이'] : ['파워포인트', '가']);
const alsoOf = (ext) => (/^\.(xls[xm]?|ods)$/.test(ext) ? '(또는 한셀)' : /^\.(pptx?|odp)$/.test(ext) ? '(또는 한쇼)' : '');
/** 변환 실패 이유를 쉬운 한국어로. code = doc2pdf.py 가 stderr 에 `[낱말]` 로 적는 것 또는 NOPY·TIMEOUT·FAIL */
export function friendlyError(ext, code) {
  const [app, josa] = appOf(ext);
  if (code === 'NOPY') return '문서 변환 도구(파이썬)를 찾지 못했어요. IRIS 설치 파일을 다시 실행하면 채워집니다.';
  if (code === 'NOAPP') return `이 PC에 ${app}${alsoOf(ext)}${alsoOf(ext) ? '이' : josa} 설치되어 있지 않아 미리보기를 만들 수 없어요.`;
  if (code === 'LOCKED') return '다른 프로그램이 이 파일을 쓰는 중이라 읽지 못했어요. 저장이 끝나거나 그 창을 닫은 뒤 다시 열어 주세요.';
  if (code === 'PASSWORD') return '암호가 걸린 문서라 미리 볼 수 없어요. 「원본 열기」로 여시거나, 암호를 푼 사본을 만들어 주세요.';
  if (code === 'EMPTY') return '아직 아무 내용이 없는 문서예요. 내용이 생기면 저절로 보여 드릴게요.';
  if (code === 'TIMEOUT') return `변환이 너무 오래 걸려 멈췄어요. ${app} 안내 창이 떠 있으면 닫고 다시 열어 주세요.`;
  return `${app}에서 이 문서를 바꾸지 못했어요. 파일이 아직 저장되는 중이거나 손상됐을 수 있어요.`;
}

export function isConvertible(file) {
  return DOC_EXTS.includes(path.extname(file).toLowerCase());
}

// 변환 결과 PDF 의 캐시 경로 = 원본 경로 + 수정시각 지문. 원본이 바뀌면 새로 변환한다.
function cachePath(cacheDir, src) {
  const st = fs.statSync(src);
  const key = crypto.createHash('sha1').update(`${src}|${st.mtimeMs}|${st.size}`).digest('hex').slice(0, 16);
  const base = path.basename(src).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  return path.join(cacheDir, `${key}-${base}.pdf`);
}

const inflight = new Map(); // 같은 파일 동시 요청은 한 번만 변환

// 변환은 한 번에 하나씩(오피스·한/글은 프로그램 하나를 나눠 써서 겹치면 서로 끈다) — 앞 일이 실패해도 다음 일은 돈다.
let tail = Promise.resolve();
export const enqueue = (fn) => { const p = tail.then(fn, fn); tail = p.catch(() => {}); return p; };
const TIMEOUT_MS = 180_000;

/** 파이썬 하나로 한 번. → { code, err } (code 'ENOENT' = 실행 자체가 안 됨, 'TIMEOUT' = 시간 초과). py 가 배열이면 [실행파일, 스크립트] (시험용). */
function runPy(py, src, out) {
  const [exe, script] = Array.isArray(py) ? py : [py, PY];
  return new Promise((resolve) => {
    let err = '', done = false, timer = null;
    const end = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, err }); };
    // PYTHONUTF8: 경로에 든 〖 같은 글자를 win32com makepy 가 cp949 콘솔로 print 하다 죽는 것을 막는다(R-010 계열).
    const child = spawn(exe, [script, src, out], { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
    timer = setTimeout(() => { try { child.kill(); } catch {} end('TIMEOUT'); }, TIMEOUT_MS);
    child.stdout?.resume(); child.stderr?.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { err += e.message; end('ENOENT'); });
    child.on('close', (code) => end(code));
  });
}

// src(문서) → PDF 경로. 캐시 적중 시 즉시 반환. cacheDir = state/doc-cache. opts.candidates = 시험용 파이썬 목록.
export function toPdf(src, cacheDir, log = () => {}, opts = {}) {
  const ext = path.extname(src).toLowerCase();
  if (!fs.existsSync(src)) return Promise.reject(new Error(`파일이 없습니다: ${src}`));
  if (!isConvertible(src)) return Promise.reject(new Error(`변환할 수 없는 형식: ${ext}`));
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = cachePath(cacheDir, src);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return Promise.resolve(out);
  if (inflight.has(out)) return inflight.get(out);

  const job = enqueue(async () => {
    const candidates = opts.candidates || pyCandidates(ext === '.hwp' || ext === '.hwpx' ? 'hwp' : 'office');
    const part = `${out.slice(0, -4)}.part.pdf`; // 다 된 뒤에만 이름을 바꾼다 — 도중에 끊긴 반쪽 PDF 가 캐시로 남지 않게
    const t0 = Date.now(); let code = 'NOPY', err = '';
    for (const py of candidates) {
      try { fs.rmSync(part, { force: true }); } catch {}
      let r = await runPy(py, src, part);
      // 파워포인트는 하나만 떠서, 사용자가 마침 창을 열거나 닫는 순간이면 연결이 끊긴다 — 한 번만 다시(P18 2026-11-25 점검)
      if (r.code === 1 && /^\.(pptx?|odp)$/.test(ext) && !/\[(NOAPP|LOCKED|TIMEOUT|PASSWORD|EMPTY)\]/.test(r.err)) { await new Promise((ok) => setTimeout(ok, opts.retryMs ?? 3000)); r = await runPy(py, src, part); }
      if (r.code === 0 && fs.existsSync(part) && fs.statSync(part).size > 0) {
        fs.renameSync(part, out);
        log(`doc2pdf ${ext} ${((Date.now() - t0) / 1000).toFixed(1)}s ${path.basename(src)}`);
        return out;
      }
      err = r.err;
      if (r.code === 3 || r.code === 'ENOENT') continue; // 이 파이썬에는 모듈이 없거나 실행이 안 됨 → 다음 후보
      code = r.code === 'TIMEOUT' ? 'TIMEOUT' : /\[(NOAPP|LOCKED|TIMEOUT|PASSWORD|EMPTY)\]/.exec(r.err)?.[1] || 'FAIL';
      break;
    }
    try { fs.rmSync(part, { force: true }); } catch {}
    log(`doc2pdf FAIL ${ext} ${code} ${path.basename(src)}: ${err.trim().split('\n').pop() || ''}`);
    throw new Error(friendlyError(ext, code));
  }).finally(() => inflight.delete(out));
  inflight.set(out, job);
  return job;
}
