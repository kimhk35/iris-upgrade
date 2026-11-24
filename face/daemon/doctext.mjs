// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// doctext.mjs — 첨부 파일의 글자 뽑기(P18 2026-11-24 2차 시안 2번: 첨부 속 개인정보 확인). 이 PC 안에서만, 원본은 읽기만.
//   글 파일 = 그대로(UTF-8·UTF-16·EUC-KR) / hwpx·docx·pptx·xlsx = 압축 속 XML 을 바로 읽음(오피스 없어도 됨) /
//   PDF = pypdfium2 / 옛 형식(hwp·doc·ppt·xls…) = PDF 로 바꿔 읽음 / 그림·스캔 = 알 수 없음.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { zipRead } from './zip.mjs';
import { toPdf, isConvertible, pyCandidates } from './doc2pdf.mjs';

const PY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'doctext.py');
export const TEXT_LIMIT = 2_000_000; // 글자
const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.html', '.htm', '.log', '.srt', '.yml', '.yaml', '.ini', '.py', '.js', '.css', '.sql', '.tex', '.r']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.svg']);

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unxml = (s) => String(s).replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] !== '#') return ENT[e.toLowerCase()];
  const c = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch { return m; }
});
/** 글자 파일: BOM → UTF-8(깨지지 않으면) → EUC-KR(CP949) */
export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('euc-kr').decode(buf); }
}
/** 문단 안 글 조각만 잇고, 문단 끝 = 줄바꿈, 표 칸 끝 = 탭 */
function runs(xml, { t, p, cell, tab, br }) {
  const re = new RegExp(`<(?:${t})(?:\\s[^>]*)?>([\\s\\S]*?)</(?:${t})>|</(?:${p})>|${cell ? `</(?:${cell})>` : '(?!)'}|<(?:${tab})(?:\\s[^>]*)?/>|<(?:${br})(?:\\s[^>]*)?/>`, 'g');
  let out = '';
  for (const m of xml.matchAll(re)) {
    if (m[1] !== undefined) out += unxml(m[1].replace(/<[^>]+>/g, ''));
    else if (m[0].startsWith('</') && cell && new RegExp(`^</(?:${cell})>`).test(m[0])) out = `${out.replace(/\n+$/, '')}\t`;
    else out += m[0].startsWith('</') || new RegExp(`^<(?:${br})[\\s/]`).test(m[0]) ? '\n' : '\t';
  }
  return out;
}
const byNo = (a, b) => (Number(a.name.match(/(\d+)\.xml$/)?.[1]) || 0) - (Number(b.name.match(/(\d+)\.xml$/)?.[1]) || 0);

export function textFromZip(buf, ext) {
  const es = zipRead(buf); const pickE = (re) => es.filter((e) => re.test(e.name)).sort(byNo).map((e) => e.data.toString('utf8'));
  if (ext === '.hwpx') return pickE(/^Contents\/(section\d+|header)\.xml$/i).map((x) => runs(x, { t: 'hp:t', p: 'hp:p', cell: 'hp:tc', tab: 'hp:tab', br: 'hp:lineBreak' })).join('\n');
  if (ext === '.docx') return pickE(/^word\/(document|header\d*|footer\d*|footnotes|comments)\.xml$/).map((x) => runs(x, { t: 'w:t', p: 'w:p', cell: 'w:tc', tab: 'w:tab', br: 'w:br' })).join('\n');
  if (ext === '.pptx') return pickE(/^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/).map((x) => runs(x, { t: 'a:t', p: 'a:p', cell: 'a:tc', tab: 'a:tab', br: 'a:br' })).join('\n');
  // xlsx: 공용 글 + 시트마다 줄·칸
  const shared = [...(pickE(/^xl\/sharedStrings\.xml$/)[0] || '').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => unxml(x[1])).join(''));
  return pickE(/^xl\/worksheets\/sheet\d+\.xml$/).map((x) => [...x.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c(\s[^>]*)?>([\s\S]*?)<\/c>/g)].map((c) => {
    const type = /\bt="(\w+)"/.exec(c[1] || '')?.[1];
    if (type === 'inlineStr') return [...c[2].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((k) => unxml(k[1])).join('');
    const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(c[2])?.[1]; if (v == null) return '';
    return type === 's' ? shared[Number(v)] ?? '' : unxml(v);
  }).join('\t')).join('\n')).join('\n');
}

function pdfText(pdf, candidates) {
  const one = (py) => new Promise((resolve) => {
    const [exe, script] = Array.isArray(py) ? py : [py, PY]; const out = []; let err = '';
    const c = spawn(exe, [script, pdf], { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
    const timer = setTimeout(() => { try { c.kill(); } catch {} }, 60_000);
    c.stdout.on('data', (d) => out.push(d)); c.stderr.on('data', (d) => { err += d; });
    c.on('error', () => { clearTimeout(timer); resolve(null); }); c.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? Buffer.concat(out).toString('utf8') : null); });
  });
  return (async () => { for (const py of candidates || pyCandidates('office')) { const t = await one(py); if (t != null) return t; } return null; })();
}

/** → { kind:'text'|'image'|'none', text, truncated } — 못 읽으면 kind 'none'(호출부가 「확인하지 못함」으로 알린다) */
export async function extractText(file, { cacheDir, log = () => {}, candidates = null } = {}) {
  const ext = path.extname(file).toLowerCase(); let text = null;
  if (IMAGE_EXT.has(ext)) return { kind: 'image', text: '', truncated: false };
  try {
    if (TEXT_EXT.has(ext)) text = decodeText(fs.readFileSync(file));
    else if (['.hwpx', '.docx', '.pptx', '.xlsx'].includes(ext)) text = textFromZip(fs.readFileSync(file), ext);
    else if (ext === '.pdf') text = await pdfText(file, candidates);
    else if (isConvertible(file) && cacheDir) text = await pdfText(await toPdf(file, cacheDir, log), candidates);
  } catch (e) { log(`doctext ${path.basename(file)}: ${e.message}`); }
  if (text == null) return { kind: 'none', text: '', truncated: false };
  text = text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
  return ext === '.pdf' && !text.trim() ? { kind: 'image', text: '', truncated: false } : { kind: 'text', text: text.slice(0, TEXT_LIMIT), truncated: text.length > TEXT_LIMIT };
}
