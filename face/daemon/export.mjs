// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// export.mjs — 대화 내보내기(P18 2026-11-24 2차 시안 4번): 화면이 만든 HTML 을 「다운로드」 폴더에 한글·워드·HTML 로. 있던 파일은 덮지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pyCandidates, enqueue } from './doc2pdf.mjs';

const PY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'htmldoc.py');
export const safeName = (s) => String(s || '대화').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 50) || '대화';
function freePath(dir, name, ext) { let f = path.join(dir, `${name}${ext}`); for (let n = 2; fs.existsSync(f); n++) f = path.join(dir, `${name} (${n})${ext}`); return f; }

function run(py, src, out) {
  const [exe, script] = Array.isArray(py) ? py : [py, PY];
  return new Promise((resolve) => {
    let err = ''; const c = spawn(exe, [script, src, out], { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
    const timer = setTimeout(() => { try { c.kill(); } catch {} }, 120_000); c.stdout?.resume(); c.stderr?.on('data', (d) => { err += d; });
    c.on('error', () => { clearTimeout(timer); resolve({ code: 'ENOENT', err }); }); c.on('close', (code) => { clearTimeout(timer); resolve({ code, err }); });
  });
}
/** → { path, name, format, note? } — 한글·워드가 없으면 HTML 로 저장하고 이유를 note 로. */
export async function exportDoc({ title, html, format = 'html', dir = process.env.IRIS_FACE_EXPORT_DIR || path.join(os.homedir(), 'Downloads'), candidates = null, log = () => {} }) {
  if (typeof html !== 'string' || !html.startsWith('<!doctype html>') || html.length > 20_000_000) throw new Error('내보낼 내용이 올바르지 않아요.');
  if (/<(?:script|iframe|object|embed)\b|<[a-z][^>]*\son\w+\s*=/i.test(html)) throw new Error('내보낼 내용이 올바르지 않아요.');
  fs.mkdirSync(dir, { recursive: true }); const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const name = `IRIS 대화 - ${safeName(title)} ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  if (format === 'hwpx' || format === 'docx') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-export-')); const src = path.join(tmp, 'doc.html'), mid = path.join(tmp, `doc.${format}`);
    try {
      fs.writeFileSync(src, html, 'utf8');
      const made = await enqueue(async () => { for (const py of candidates || pyCandidates(format === 'hwpx' ? 'hwp' : 'office')) { const r = await run(py, src, mid); if (r.code === 0 && fs.existsSync(mid)) return true; log(`export ${format}: ${String(r.err).trim().split('\n').pop()}`); if (r.code !== 3 && r.code !== 'ENOENT') return false; } return false; });
      if (made) { const out = freePath(dir, name, `.${format}`); fs.copyFileSync(mid, out, fs.constants.COPYFILE_EXCL); return { path: out, name: path.basename(out), format }; }
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  }
  const out = freePath(dir, name, '.html'); fs.writeFileSync(out, html, { encoding: 'utf8', flag: 'wx' });
  return { path: out, name: path.basename(out), format: 'html', ...(format !== 'html' ? { note: `이 PC에서 ${format === 'hwpx' ? '한글' : '워드'} 파일을 만들지 못해 HTML로 저장했어요.` } : {}) };
}
