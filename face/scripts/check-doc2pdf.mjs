// 문서 → PDF 변환 검사(P18, 2026-11-24 신고 "캔버스에서 PPT 조회가 이상하게 됨 · 워드·hwpx 도 되어야 함").
// ① 파이썬 찾기: 설치본의 문서용 파이썬(_agent\runtime\venvs\document-mcp)을 쓴다 ② 모듈이 없거나 실행이 안 되는 파이썬은 다음 후보로
// ③ 반쪽 PDF 를 완성본으로 남기지 않는다 ④ 같은 앱을 동시에 여러 번 띄우지 않는다(한 줄로) ⑤ 실패 이유는 한국어 ⑥ 실제 변환(오피스·한/글이 있는 PC 에서만)
//   npm run verify:doc2pdf        실제 변환까지 = IRIS_DOC_REAL=1 npm run verify:doc2pdf
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-doc2pdf-'));
process.env.IRIS_ROOT = tmp;
delete process.env.IRIS_FACE_PY; delete process.env.IRIS_FACE_HWP_PY;
const { pyCandidates, toPdf, friendlyError } = await import('../daemon/doc2pdf.mjs');
const { openPages, pageFile, pageHashes, sweepCache, idOf, ID_RE } = await import('../daemon/docpages.mjs');

let pass = 0, skip = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('PASS', name); };
const doc = (n) => { const p = path.join(tmp, n); fs.writeFileSync(p, 'x'); return p; };
// 가짜 파이썬: node 로 도는 흉내(실행 명령을 배열로 줄 수 있다)
const fake = (n, body) => { const p = path.join(tmp, n); fs.writeFileSync(p, body); return [process.execPath, p]; };

await t('설치본의 문서용 파이썬(venv)이 후보에 있고 시스템 파이썬보다 앞', () => {
  const venv = path.join(tmp, '_agent', 'runtime', 'venvs', 'document-mcp', 'Scripts', 'python.exe');
  fs.mkdirSync(path.dirname(venv), { recursive: true }); fs.writeFileSync(venv, '');
  for (const kind of ['hwp', 'office']) assert.equal(pyCandidates(kind)[0], venv, kind);
});
await t('환경변수로 준 파이썬이 가장 먼저', () => {
  process.env.IRIS_FACE_PY = path.join(tmp, '_agent', 'runtime', 'venvs', 'document-mcp', 'Scripts', 'python.exe');
  assert.equal(pyCandidates('office')[0], process.env.IRIS_FACE_PY); delete process.env.IRIS_FACE_PY;
});
await t('모듈이 없는 파이썬(3)·실행 안 되는 파이썬은 건너뛰고 다음 후보로', async () => {
  const no = fake('no.mjs', 'process.exit(3)');
  const good = fake('good.mjs', "import fs from 'node:fs'; fs.writeFileSync(process.argv[3], '%PDF-1.4 ok');");
  const out = await toPdf(doc('a.pptx'), path.join(tmp, 'c1'), () => {}, { candidates: [path.join(tmp, '없는파이썬.exe'), no, good] });
  assert.match(fs.readFileSync(out, 'utf8'), /^%PDF/);
});
await t('도중에 죽으면 반쪽 PDF 를 남기지 않는다(다음에 다시 변환)', async () => {
  const half = fake('half.mjs', "import fs from 'node:fs'; fs.writeFileSync(process.argv[3], '%PDF half'); process.exit(1);");
  const good = fake('good2.mjs', "import fs from 'node:fs'; fs.writeFileSync(process.argv[3], '%PDF full');");
  const src = doc('b.pptx'), dir = path.join(tmp, 'c2');
  await assert.rejects(toPdf(src, dir, () => {}, { candidates: [half] }));
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(fs.readFileSync(await toPdf(src, dir, () => {}, { candidates: [good] }), 'utf8'), '%PDF full');
});
await t('동시에 여러 문서를 부르면 한 줄로(겹쳐 돌지 않음)', async () => {
  const lock = path.join(tmp, 'lock').split(path.sep).join('/');
  const one = fake('one.mjs', `import fs from 'node:fs'; if (fs.existsSync('${lock}')) process.exit(1); fs.writeFileSync('${lock}',''); await new Promise(r=>setTimeout(r,300)); fs.rmSync('${lock}'); fs.writeFileSync(process.argv[3],'%PDF');`);
  await Promise.all(['d.pptx', 'e.docx', 'f.hwpx'].map((n) => toPdf(doc(n), path.join(tmp, 'c3'), () => {}, { candidates: [one] })));
});
await t('실패 이유는 쉬운 한국어', async () => {
  await assert.rejects(toPdf(doc('g.pptx'), path.join(tmp, 'c4'), () => {}, { candidates: [] }), /문서 변환 도구/);
  assert.match(friendlyError('.pptx', 'NOAPP'), /파워포인트/);
  assert.match(friendlyError('.docx', 'NOAPP'), /워드/);
  assert.match(friendlyError('.hwpx', 'NOAPP'), /한\/글/);
  assert.match(friendlyError('.pptx', 'LOCKED'), /다른 프로그램/);
});

await t('암호 문서·빈 문서는 바로 알린다(쉬운 말)', () => { assert.match(friendlyError('.pptx', 'PASSWORD'), /암호/); assert.match(friendlyError('.xlsx', 'EMPTY'), /아무 내용/); });
{ // 암호 문서 알아보기(프로그램을 띄우지 않고) — 파이썬이 있을 때만
  const { pythonExe } = await import('../daemon/paths.mjs'); const { spawnSync } = await import('node:child_process');
  const py = process.env.IRIS_DOC_PY || pythonExe();
  if (!py) { skip++; console.log('SKIP 암호 문서 알아보기(파이썬 없음)'); }
  else await t('암호 걸린 docx·hwp 는 알아보고, 보통 문서는 아니라고 본다', () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]); const f = (n, ...b) => { const p = path.join(tmp, n); fs.writeFileSync(p, Buffer.concat(b)); return p; };
    const hwp = (flag) => [ole, Buffer.alloc(508), Buffer.from('HWP Document File'), Buffer.alloc(15), Buffer.from([1, 0, 1, 5]), Buffer.from([flag, 0, 0, 0])];
    const files = [f('a1.docx', ole, Buffer.from('EncryptedPackage', 'utf16le')), f('a2.docx', Buffer.from('PK')), f('a3.hwp', ...hwp(3)), f('a4.hwp', ...hwp(1))];
    const code = 'import sys,os,json;sys.path.insert(0,sys.argv[1]);import doc2pdf;print(json.dumps([doc2pdf.encrypted(p,os.path.splitext(p)[1]) for p in sys.argv[2:]]))';
    const r = spawnSync(py, ['-B', '-c', code, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'daemon'), ...files], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' }, cwd: tmp });
    assert.deepEqual(JSON.parse(r.stdout || '0'), [true, false, true, false], r.stderr);
  });
}

// ── 쪽 그림(docpages) ──
const pdfOf = (n) => { const p = path.join(tmp, `${n.padStart(16, '0')}-x.pptx.pdf`); fs.writeFileSync(p, '%PDF'); return p; };
await t('쪽 그림: 모듈 없는 파이썬은 건너뛰고, 앞쪽부터 생기는 대로 · 끝나면 지문', async () => {
  const no = fake('pno.mjs', 'process.exit(3)');
  const yes = fake('pyes.mjs', "import fs from 'node:fs'; import path from 'node:path'; const d=process.argv[3]; fs.mkdirSync(d,{recursive:true}); fs.writeFileSync(path.join(d,'info.json'),JSON.stringify({n:2,sizes:[[16,9],[16,9]]})); for (const n of [1,2]) { await new Promise(r=>setTimeout(r,250)); fs.writeFileSync(path.join(d,`p${n}.jpg`),'j'); } fs.writeFileSync(path.join(d,'hashes.json'),'[\"a\",\"b\"]');");
  const pdf = pdfOf('a1'); const info = await openPages(pdf, () => {}, { candidates: [no, yes] });
  assert.equal(info.n, 2); assert.match(info.id, ID_RE); assert.equal(info.id, idOf(pdf));
  assert.ok(await pageFile(info.id, 2)); assert.equal(await pageFile(info.id, 3), null); assert.deepEqual(await pageHashes(info.id), ['a', 'b']);
  assert.equal(await pageFile('ffffffffffffffff', 1), null);
});
await t('쪽 그림을 못 그리는 PC = 오류(화면은 PDF 로 보여 줌)', async () => { await assert.rejects(openPages(pdfOf('a2'), () => {}, { candidates: [] })); });
await t('오래된 미리보기만 정리(다른 파일은 안 건드림)', () => {
  const d = path.join(tmp, 'sweep'); fs.mkdirSync(d); const old = new Date(Date.now() - 20 * 86400000);
  for (const n of ['0123456789abcdef-a.pptx.pdf', 'fedcba9876543210-b.pptx.pdf', '내 파일.pdf']) fs.writeFileSync(path.join(d, n), 'x');
  for (const n of ['0123456789abcdef-a.pptx.pdf', '내 파일.pdf']) fs.utimesSync(path.join(d, n), old, old);
  assert.equal(sweepCache(d), 1); assert.deepEqual(fs.readdirSync(d).sort(), ['fedcba9876543210-b.pptx.pdf', '내 파일.pdf'].sort());
});

if (process.env.IRIS_DOC_REAL === '1') {
  const dir = process.env.IRIS_DOC_SAMPLES;
  for (const n of fs.readdirSync(dir).filter((x) => /\.(pptx?|docx?|hwpx?|xlsx?)$/i.test(x) && !x.startsWith('~$'))) await t(`실제 변환 ${n}`, async () => {
    const t0 = Date.now(); const py = process.env.IRIS_DOC_PY;
    const out = await toPdf(path.join(dir, n), path.join(tmp, 'real'), () => {}, py ? { candidates: [py] } : {});
    const head = fs.readFileSync(out).subarray(0, 5).toString(); assert.equal(head, '%PDF-'); console.log(`     ${fs.statSync(out).size}바이트 · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
    if (process.env.IRIS_DOC_OUT) fs.copyFileSync(out, path.join(process.env.IRIS_DOC_OUT, `${n}.pdf`));
  });
} else { skip++; console.log('SKIP 실제 변환(IRIS_DOC_REAL=1 이 아님)'); }
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`check-doc2pdf: ${pass} PASS${skip ? ` · ${skip} SKIP` : ''}`);
