// 2차 고도화 검사(P18 2026-11-24): 앞 판 보관·되돌리기 · 첨부 글자 뽑기 · 서식함 · 내보내기. 네트워크·실 데몬 접촉 0.   npm run verify:docplus
// 진짜 한/글·워드·한쇼·한셀까지 = IRIS_DOC_REAL=1 IRIS_DOC_PY=<문서용 파이썬> IRIS_DOC_SAMPLES=<폴더>. 이름·번호는 모두 지어낸 것.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DocVersions } from '../daemon/docversions.mjs';
import { extractText, decodeText, textFromZip } from '../daemon/doctext.mjs';
import { Templates, DEFAULTS } from '../daemon/templates.mjs';
import { exportDoc, safeName } from '../daemon/export.mjs';
import { zipWrite } from '../daemon/zip.mjs';
new Function(fs.readFileSync(new URL('../app/privacy.js', import.meta.url), 'utf8'))();
const { scan, mask } = globalThis.__irisPrivacy;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-docplus-')); let pass = 0, skip = 0;
const t = async (n, f) => { await f(); pass++; console.log('PASS', n); };
const doc = path.join(tmp, '수업.pptx'); let clock = Date.now(); const put = (s, f = doc) => { fs.writeFileSync(f, s); clock += 5000; const d = new Date(clock); fs.utimesSync(f, d, d); };
const mkv = (o = {}) => new DocVersions({ dir: path.join(tmp, 'ver'), now: () => clock, ...o });

// ── 앞 판 ──
await t('앞 판: 바뀐 판만 쌓이고 지금 판을 안다', () => {
  const v = mkv(); put('하나'); const a = v.keep(doc); assert.equal(v.keep(doc), a); put('둘'); const b = v.keep(doc); assert.notEqual(a, b);
  assert.deepEqual(v.list(doc).map((x) => [x.v, x.cur]), [[a, false], [b, true]]);
});
await t('앞 판: 되돌리면 지금 판도 남고, 다시 돌아올 수 있다', () => {
  const v = mkv(); put('셋(보관 안 함)'); const first = v.list(doc)[0].v; v.restore(doc, first); assert.equal(fs.readFileSync(doc, 'utf8'), '하나');
  const l = v.list(doc); assert.equal(l.length, 3); assert.equal(l.find((x) => x.cur).v, first);
  const three = l.map((x) => v.get(doc, x.v).file).find((f) => fs.readFileSync(f, 'utf8').startsWith('셋')); assert.ok(three); v.restore(doc, path.basename(three, '.pptx')); assert.equal(fs.readFileSync(doc, 'utf8'), '셋(보관 안 함)');
});
await t('앞 판: 없는 판 번호·이상한 번호는 거절, 원본 그대로', () => { const v = mkv(); for (const x of ['0123456789abcdef', '..\\..\\x', '', null]) assert.throws(() => v.restore(doc, x)); assert.equal(fs.readFileSync(doc, 'utf8'), '셋(보관 안 함)'); });
await t('앞 판: 문서마다 10판까지, 밀려난 사본은 지움', () => { const v = mkv(); for (let i = 0; i < 14; i++) { put(`판 ${i}`); v.keep(doc); } assert.equal(v.list(doc).length, 10); const home = path.join(tmp, 'ver', fs.readdirSync(path.join(tmp, 'ver'))[0]); assert.equal(fs.readdirSync(home).filter((x) => x.endsWith('.pptx')).length, 10); });
await t('앞 판: 14일 · 전체 용량 한도', () => { const v = mkv(); clock += 15 * 86400000; v.sweep(); assert.equal(v.list(doc).length, 0); const w = mkv({ maxTotal: 25 }); for (let i = 0; i < 4; i++) { put(`0123456789${i}`); w.keep(doc); } assert.equal(w.list(doc).length, 2); });
await t('앞 판: 끄면 보관 안 함 · 문서 아닌 것·빈 파일 제외', () => { const v = mkv({ enabled: () => false }); put('끔'); assert.equal(v.keep(doc), null); const on = mkv(); const x = path.join(tmp, 'a.js'); fs.writeFileSync(x, '1'); assert.equal(on.keep(x), null); const e = path.join(tmp, 'e.docx'); fs.writeFileSync(e, ''); assert.equal(on.keep(e), null); });
await t('앞 판: 글에 나온 이름만, 비밀 폴더·IRIS 안 파일은 제외', () => { const v = mkv(); fs.mkdirSync(path.join(tmp, 'secrets')); put('비밀', path.join(tmp, 'secrets', '비.pptx')); put('a', path.join(tmp, '가.hwpx')); assert.equal(v.keepMentioned(tmp, ['가.hwpx', 'secrets/비.pptx', '없음.docx', path.join(tmp, '가.hwpx')]), 2); assert.equal(v.keepMentioned(tmp, ['가.hwpx'], tmp), 0); });
await t('앞 판: 쓰는 중인 파일은 건드리지 않고 알린다', () => {
  const v = mkv(); put('원래'); v.keep(doc); put('다음'); v.keep(doc); const first = v.list(doc).find((x) => !x.cur).v;
  const rn = fs.renameSync; fs.renameSync = (a, b) => { if (b === doc) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return rn(a, b); };
  try { assert.throws(() => v.restore(doc, first), /다른 프로그램/); } finally { fs.renameSync = rn; }
  assert.equal(fs.readFileSync(doc, 'utf8'), '다음'); assert.ok(!fs.readdirSync(tmp).some((x) => x.includes('.iris-')));
});

// ── 첨부 글자 ──
const z = (files) => zipWrite(Object.entries(files).map(([name, s]) => ({ name, data: Buffer.from(s, 'utf8'), deflate: true })));
await t('글자: 한글 hwpx(표 칸) · 워드 · PPT · 엑셀', () => {
  const hwpx = textFromZip(z({ 'Contents/section0.xml': '<hp:p><hp:run><hp:t>상담 &amp; 기록</hp:t></hp:run></hp:p><hp:tbl><hp:tr><hp:tc><hp:p><hp:run><hp:t>10203</hp:t></hp:run></hp:p></hp:tc><hp:tc><hp:p><hp:run><hp:t>김민</hp:t></hp:run><hp:run><hp:t>수</hp:t></hp:run></hp:p></hp:tc></hp:tr></hp:tbl>' }), '.hwpx');
  assert.match(hwpx, /상담 & 기록/); assert.equal(scan(hwpx)[0]?.name, '김민수');
  const docx = textFromZip(z({ 'word/document.xml': '<w:p><w:r><w:t xml:space="preserve">연락처 010-</w:t></w:r><w:r><w:t>1234-5678</w:t></w:r></w:p>' }), '.docx'); assert.equal(scan(docx)[0]?.type, 'phone');
  assert.match(textFromZip(z({ 'ppt/slides/slide2.xml': '<a:p><a:r><a:t>둘</a:t></a:r></a:p>', 'ppt/slides/slide1.xml': '<a:p><a:r><a:t>하나</a:t></a:r></a:p>' }), '.pptx'), /하나\n[\s\S]*둘/);
  const x = textFromZip(z({ 'xl/sharedStrings.xml': '<sst><si><t>이름</t></si><si><r><t>이서</t></r><r><t>연</t></r></si></sst>', 'xl/worksheets/sheet1.xml': '<row r="1"><c r="A1"><v>30115</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"/></row>' }), '.xlsx'); assert.equal(scan(x)[0]?.name, '이서연');
});
await t('글자: EUC-KR · UTF-16 · 그림 · 모르는 형식', async () => {
  assert.equal(decodeText(Buffer.from([0xb1, 0xe8, 0xb9, 0xce, 0xbc, 0xf6])), '김민수'); assert.equal(decodeText(Buffer.from('﻿가', 'utf16le')), '가');
  const f = (n, d) => { const p = path.join(tmp, n); fs.writeFileSync(p, d); return p; };
  assert.equal((await extractText(f('a.csv', '10203,김민수'))).text, '10203,김민수'); assert.equal((await extractText(f('a.png', 'x'))).kind, 'image'); assert.equal((await extractText(f('a.zip', 'x'))).kind, 'none'); assert.equal((await extractText(f('깨진.docx', 'x'))).kind, 'none');
});
await t('가리기: 여러 첨부·글에서 같은 학생은 같은 이름표', () => { const s = new Map(); const a = '10203 김민수\n10204 이서연', b = '김민수 상담. 10204 이서연'; scan(a, s); scan(b, s); assert.equal(mask(a, scan(a, s), { students: s }), '[학생1]\n[학생2]'); assert.equal(mask(b, scan(b, s), { students: s }), '[학생1] 상담. [학생2]'); });
await t('가리기: 명렬표 1만 줄도 빠름', () => { const s = new Map(); const L = '가나다라마바사아자차카타파하'; const big = Array.from({ length: 10000 }, (_, i) => `${1 + (i % 3)}${String(1 + (i % 20)).padStart(2, '0')}${String(1 + (i % 40)).padStart(2, '0')}\t김${L[i % 14]}${L[(i * 7) % 14]}\t010-1234-${String(1000 + (i % 9000))}`).join('\n'); const a = Date.now(); const f = scan(big, s); mask(big, f, { students: s }); assert.ok(f.length >= 10000); assert.ok(Date.now() - a < 4000, `${Date.now() - a}ms`); });

// ── 서식함 ──
await t('서식함: 처음 = 기본 8개 · 저장·빈 목록 존중 · 이상한 값 거름', () => { const f = path.join(tmp, 't', 'templates.json'); const q = new Templates(f); assert.equal(q.get().length, 8); assert.equal(DEFAULTS.length, 8); assert.deepEqual(q.set([{ name: ' 가 ', text: '나 {다}' }, { name: '', text: 'x' }, null, { name: 'x'.repeat(99), text: 'y' }]).map((x) => x.name.length), [1, 40]); q.set([]); assert.deepEqual(q.get(), []); });

// ── 내보내기 ──
const H = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>t</title></head><body><h1>2학기 수행평가</h1><h2>나</h2><p>one = 1 을 설명해 줘</p><table><tr><td>가</td><td>나</td></tr></table></body></html>';
await t('내보내기: HTML · 있던 파일은 안 덮음 · 이름 다듬기', async () => { const d = path.join(tmp, 'dl'); const a = await exportDoc({ title: 'a/b:c*', html: H, dir: d }); const b = await exportDoc({ title: 'a/b:c*', html: H, dir: d }); assert.notEqual(a.path, b.path); assert.equal(fs.readFileSync(a.path, 'utf8'), H); assert.equal(safeName(' .. '), '대화'); assert.equal(safeName('a\\..\\b'), 'a .. b'); });
await t('내보내기: 스크립트가 든 내용은 거절 · 프로그램 없으면 HTML + 안내', async () => { await assert.rejects(exportDoc({ title: 'x', html: H.replace('<h1>', '<img onerror=a()><h1>'), dir: tmp })); await assert.rejects(exportDoc({ title: 'x', html: H + '<script>1</script>', dir: tmp })); const r = await exportDoc({ title: 'x', html: H, format: 'hwpx', candidates: [], dir: path.join(tmp, 'dl') }); assert.equal(r.format, 'html'); assert.match(r.note, /한글/); });

if (process.env.IRIS_DOC_REAL === '1') {
  const py = process.env.IRIS_DOC_PY, S = process.env.IRIS_DOC_SAMPLES; const { toPdf } = await import('../daemon/doc2pdf.mjs');
  for (const f of ['hwpx', 'docx']) await t(`진짜 내보내기 ${f}`, async () => { const r = await exportDoc({ title: '진짜', html: H, format: f, candidates: [py], dir: path.join(tmp, 'dl'), log: console.log }); assert.equal(r.format, f); const x = await extractText(r.path); assert.match(x.text, /수행평가/); assert.match(x.text, /one = 1/); console.log('     ', path.basename(r.path), fs.statSync(r.path).size); });
  for (const n of fs.readdirSync(S).filter((x) => /\.(hwp|pdf|xls)$/i.test(x))) await t(`진짜 글자 ${n}`, async () => { const x = await extractText(path.join(S, n), { cacheDir: path.join(tmp, 'c'), candidates: [py], log: console.log }); assert.equal(x.kind, 'text'); assert.ok(x.text.trim().length > 20); });
  process.env.IRIS_DOC_HANCOM = '1';
  for (const n of fs.readdirSync(S).filter((x) => /\.(pptx|xlsx)$/i.test(x)).slice(0, 4)) await t(`오피스 없이(한쇼·한셀) ${n}`, async () => { const o = await toPdf(path.join(S, n), path.join(tmp, 'hc'), console.log, { candidates: [py] }); assert.equal(fs.readFileSync(o).subarray(0, 5).toString(), '%PDF-'); });
} else { skip++; console.log('SKIP 진짜 프로그램(IRIS_DOC_REAL=1 이 아님)'); }
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`check-docplus: ${pass} PASS${skip ? ` · ${skip} SKIP` : ''}`);
