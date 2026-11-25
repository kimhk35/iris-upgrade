// 릴리스와 홈페이지를 함께 공개(P18 2026-11-25 사용자 요청 「홈페이지에도 동시에 올려」). 하나라도 어긋나면 공개하지 않고 멈춘다.
//   node release-site/publish.mjs check                 판 번호·글·파일이 모두 같은지만 본다(바깥 접촉 0)
//   node release-site/publish.mjs pack --key <열쇠>      창 zip · update.json · 서명 만들기(지난 판 zip 과 견주어 「작은 업데이트」로 갈 수 있는지 정함: --prev <지난 설치 zip>)
//   node release-site/publish.mjs draft                 릴리스를 비공개 초안으로 올리고 홈페이지는 미리보기 주소로
//   node release-site/publish.mjs open                  사용자가 「공개해줘」라고 한 뒤에만: 릴리스 공개 → 홈페이지 공개 → 다시 내려받아 확인
// 개인 열쇠는 ~/.claude/secrets/ 에만 있고 이 스크립트는 값을 찍지 않는다. 커밋·푸시는 하지 않는다(draft 가 푸시됐는지 확인만).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { zipWrite, zipOpenFile, zipEntryDataFile } from '../face/daemon/zip.mjs';
import { buildManifest, signManifest, verifyManifest, sha256 } from '../face/daemon/modsign.mjs';
import { parseSmall } from '../face/daemon/updatesmall.mjs';
import { verifyFaceZip, PART_LIMITS, cmpSemver } from '../face/daemon/update.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), P18 = path.resolve(HERE, '..'), OUT = path.join(P18, 'installer', '_build', 'out');
const [cmd, ...args] = process.argv.slice(2); const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const rd = (...p) => fs.readFileSync(path.join(P18, ...p), 'utf8');
const REPO = 'kimhk35/iris-upgrade', HOME = 'https://iris.mathmckay.kr', SCOPE = 'kimhk35-7930';
const GH = path.join(process.env.USERPROFILE, '.claude', 'tools', 'gh', 'bin', 'gh.exe'), VERCEL = path.join(process.env.APPDATA, 'npm', 'vercel.cmd');
const lock = JSON.parse(rd('installer', 'lock.json')), V = lock.package.version, face = JSON.parse(rd('face', 'package.json'));
const TAG = `iris-installer--v${V}`;
const zips = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((n) => n.startsWith(`IRIS-Setup_v${V}_`) && n.endsWith('.zip')) : [];
const SETUP = zips.length === 1 ? path.join(OUT, zips[0]) : null, FACE = path.join(OUT, `IRIS-Face_v${face.version}.zip`), UPD = path.join(OUT, 'update.json');
const bad = []; const need = (c, m) => { if (!c) bad.push(m); else console.log('  맞음', m); };
const stop = (m) => { console.error(`멈춤: ${m}`); process.exit(1); };
const run = (exe, a, o = {}) => { const r = spawnSync(exe, a, { encoding: 'utf8', windowsHide: true, cwd: P18, ...o }); if (r.status !== 0) stop(`${path.basename(exe)} ${a.slice(0, 3).join(' ')} — ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' / ')}`); return r.stdout.trim(); };

function check({ files = true } = {}) {
  console.log(`판 ${V} · 창 ${face.version}`);
  const page = rd('release-site', 'page.src.html'), wn = rd('face', 'app', 'whatsnew.js'), man = rd('manual', 'manual.html');
  need(face.iris?.release === V, 'face/package.json iris.release');
  need(wn.includes(`RELEASE = '${V}'`), '새로운 점(whatsnew.js)');
  need(page.includes(`판 ${V} ·`) && page.includes(`고도화판 ${V} 받기`), '홈페이지 설치 칸의 판');
  need(page.includes(`/${TAG}/`) && page.includes(`/tag/${TAG}`), '홈페이지 내려받기 주소');
  need(new RegExp(`<details class="ver" open><summary><b>${V.replaceAll('.', '\\.')}</b>`).test(page), '홈페이지 업데이트 내용 맨 위');
  need(man.includes(`${V}에서 더해진 것`) || /<!-- 설명서에 새 기능 없음 -->/.test(man), '설명서');
  need(fs.existsSync(path.join(P18, 'face', 'app', 'manual', 'manual.html')) && rd('face', 'app', 'manual', 'manual.html') === man, 'IRIS 안 설명서 = 원본');
  if (!files) return;
  need(!!SETUP, `설치 파일 하나(${zips.join(', ') || '없음'})`);
  if (SETUP) {
    need(page.includes(path.basename(SETUP)), '홈페이지 주소의 파일 이름');
    need(fs.statSync(SETUP).size < 629_145_600, `옛 판이 받을 수 있는 크기(${(fs.statSync(SETUP).size / 1e6).toFixed(0)}MB < 629MB)`);
    const text = fs.readFileSync(`${SETUP}.sha256`, 'utf8'); need(text.includes(sha256File(SETUP)), '지문(.sha256)');
    need(fs.existsSync(`${SETUP}.sha256.sig`) && verifyManifest(text, fs.readFileSync(`${SETUP}.sha256.sig`, 'utf8')).ok, '설치 파일 서명');
  }
  if (fs.existsSync(UPD)) {
    const t = fs.readFileSync(UPD, 'utf8'); need(verifyManifest(t, fs.readFileSync(`${UPD}.sig`, 'utf8')).ok, 'update.json 서명');
    let s = null; try { s = parseSmall(t, { release: V }); } catch (e) { bad.push(`update.json: ${e.message}`); }
    if (s) { const b = fs.readFileSync(FACE); need(s.version === face.version && sha256(b) === s.sha256 && b.length < PART_LIMITS.face.maxBytes, `창 zip 지문(${(b.length / 1e6).toFixed(1)}MB)`); const v = verifyFaceZip(b); need(v.ok, `창 zip 서명${v.ok ? '' : ` — ${v.reason}`}`); need(cmpSemver(s.from, V) <= 0, `작은 업데이트 = ${s.from}부터`); }
  } else bad.push('update.json 없음(pack 먼저)');
}
function sha256File(f) { const h = crypto.createHash('sha256'), fd = fs.openSync(f, 'r'), b = Buffer.alloc(1 << 22); for (let n; (n = fs.readSync(fd, b, 0, b.length, null)) > 0;) h.update(b.subarray(0, n)); fs.closeSync(fd); return h.digest('hex'); }

// 두 설치 zip 에서 「창」 말고 바뀐 것 — 판 번호만 다른 글 파일은 같은 것으로 본다.
function structureDiff(a, b, va, vb) {
  const read = (f) => { const z = zipOpenFile(f, PART_LIMITS.package.zip); return { z, m: new Map(z.entries.filter((e) => !e.name.endsWith('/')).map((e) => [e.name.replace(/^\.\//, ''), e])) }; };
  const A = read(a), B = read(b), out = [];
  const FACE_ONLY = /^payload\/face\/iris-face\.zip$|^payload\/manifest\.json$|^lock\.json$|^VERSION|NOTICES\.md$/;
  const same = (n) => { const x = zipEntryDataFile(A.z.fd, A.m.get(n)), y = zipEntryDataFile(B.z.fd, B.m.get(n)); if (x.equals(y)) return true; if (Math.max(x.length, y.length) > 3e6) return false; return x.toString('utf8').replaceAll(va, 'V').replace(/20\d\d-\d\d-\d\d[T0-9:.Z-]*/g, 'D') === y.toString('utf8').replaceAll(vb, 'V').replace(/20\d\d-\d\d-\d\d[T0-9:.Z-]*/g, 'D'); };
  for (const n of new Set([...A.m.keys(), ...B.m.keys()])) { if (FACE_ONLY.test(n)) continue; if (!A.m.has(n) || !B.m.has(n)) { out.push(n); continue; } const x = A.m.get(n), y = B.m.get(n); if (x.crc !== undefined && x.crc === y.crc && x.size === y.size) continue; if (!same(n)) out.push(n); }
  A.z.close(); B.z.close(); return out;
}

async function pack() {
  const key = opt('--key'); if (!key) stop('--key 가 필요합니다'); const pem = fs.readFileSync(key, 'utf8'); if (!SETUP) stop('설치 파일이 하나가 아닙니다');
  // 설치본에 들어가는 것과 똑같은 창 파일(의존 꾸러미 node_modules 는 빼고 — 받는 쪽이 전 판 것을 다시 쓴다)
  const src = path.join(P18, 'installer', '_build', 'stage', 'dir', 'face'); if (!fs.existsSync(path.join(src, 'package.json'))) stop(`빌드 폴더에 창이 없습니다: ${src}`);
  if (JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version !== face.version) stop('빌드 폴더의 창이 지금 판이 아닙니다(다시 빌드)');
  const files = []; const walk = (rel = '') => { for (const e of fs.readdirSync(path.join(src, rel), { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) { if (!rel && ['node_modules', 'state', 'modules'].includes(e.name)) continue; const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(r); else files.push({ name: r, data: fs.readFileSync(path.join(src, r)) }); } }; walk();
  const text = JSON.stringify(buildManifest(files, { release: V }), null, 1);
  fs.writeFileSync(FACE, zipWrite([...files, { name: 'manifest.json', data: Buffer.from(text) }, { name: 'manifest.sig', data: Buffer.from(`${signManifest(text, pem)}\n`) }]));
  let from = V, prev = opt('--prev'); // 지난 판이 없거나 구조가 달라졌으면 이 판부터
  if (prev) {
    const pv = /_v(\d+\.\d+\.\d+)_/.exec(prev)?.[1]; const diff = structureDiff(prev, SETUP, pv, V); console.log(`지난 판 ${pv} 과 다른 구조 파일 ${diff.length}개${diff.length ? ': ' + diff.slice(0, 12).join(', ') : ''}`);
    const lockChanged = opt('--prev-face-lock') && fs.readFileSync(opt('--prev-face-lock'), 'utf8').replace(/\r\n/g, '\n').trim() !== fs.readFileSync(path.join(src, 'package-lock.json'), 'utf8').replace(/\r\n/g, '\n').trim();
    if (!diff.length && !lockChanged) from = opt('--prev-from') || pv;
  }
  const u = JSON.stringify({ schema: 1, release: V, face: { version: face.version, asset: path.basename(FACE), sha256: sha256(fs.readFileSync(FACE)), from } }, null, 2);
  fs.writeFileSync(UPD, u); fs.writeFileSync(`${UPD}.sig`, `${signManifest(u, pem)}\n`);
  const sf = `${SETUP}.sha256`, st = fs.readFileSync(sf, 'utf8'); fs.writeFileSync(`${sf}.sig`, `${signManifest(st, pem)}\n`);
  console.log(`창 zip ${files.length}개 파일 · ${(fs.statSync(FACE).size / 1e6).toFixed(1)}MB · 작은 업데이트 = ${from}부터`);
}
const assets = () => [SETUP, `${SETUP}.sha256`, `${SETUP}.sha256.sig`, FACE, UPD, `${UPD}.sig`];
function site() { const py = path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python312', 'python.exe'); run(py, [path.join(HERE, 'build.py')], { env: { ...process.env, PYTHONUTF8: '1' } }); }
const vercel = (a) => run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', VERCEL, ...a, '--yes', '--scope', SCOPE], { cwd: path.join(HERE, 'dist') });

if (cmd === 'check') { check(); if (bad.length) stop(bad.join(' · ')); console.log('모두 같음'); }
else if (cmd === 'pack') { await pack(); check(); if (bad.length) stop(bad.join(' · ')); console.log('공개 준비 끝'); }
else if (cmd === 'draft') {
  check(); if (bad.length) stop(bad.join(' · '));
  if (run('git', ['status', '--porcelain'])) stop('저장하지 않은 변경이 있습니다'); if (run('git', ['rev-parse', 'HEAD']) !== run('git', ['rev-parse', '@{u}'])) stop('아직 올리지(push) 않은 변경이 있습니다');
  const notes = opt('--notes'); if (!notes) stop('--notes <파일> 이 필요합니다');
  run(GH, ['release', 'create', TAG, '--repo', REPO, '--draft', '--title', `IRIS 고도화판 ${V}`, '--notes-file', notes, '--target', run('git', ['rev-parse', 'HEAD']), ...assets()], { timeout: 3_600_000 });
  site(); console.log(`초안 ${TAG}\n미리보기 ${vercel(['deploy'])}`);
} else if (cmd === 'open') {
  check(); if (bad.length) stop(bad.join(' · '));
  const r = JSON.parse(run(GH, ['release', 'view', TAG, '--repo', REPO, '--json', 'isDraft,assets'])); for (const f of assets()) { const a = r.assets.find((x) => x.name === path.basename(f)); if (!a || a.size !== fs.statSync(f).size) stop(`초안의 파일이 다릅니다: ${path.basename(f)}`); }
  site(); run(GH, ['release', 'edit', TAG, '--repo', REPO, '--draft=false', '--latest']); console.log(`릴리스 공개 ${TAG}`);
  console.log(`홈페이지 ${vercel(['deploy', '--prod'])}`);
  const base = `https://github.com/${REPO}/releases/download/${TAG}/`; const get = async (n) => { const x = await fetch(base + n); if (!x.ok) stop(`다시 받기 ${n}: ${x.status}`); return Buffer.from(await x.arrayBuffer()); };
  if (sha256(await get(path.basename(SETUP))) !== sha256File(SETUP)) stop('다시 받은 설치 파일의 지문이 다릅니다');
  if (sha256(await get(path.basename(FACE))) !== sha256(fs.readFileSync(FACE))) stop('다시 받은 창 zip 의 지문이 다릅니다');
  const html = await (await fetch(`${HOME}/?v=${Date.now()}`)).text(); if (!html.includes(`판 ${V} ·`)) stop('홈페이지에 새 판이 아직 안 보입니다');
  console.log('공개 확인: 설치 파일·창 zip 지문, 홈페이지 판 번호 모두 같음');
} else { console.error('check | pack | draft | open'); process.exit(2); }
