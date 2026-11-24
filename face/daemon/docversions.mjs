// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// docversions.mjs — 문서 앞 판 보관·되돌리기(P18 2026-11-24 2차 시안 1번). PPT·워드·한/글·엑셀만.
//   보관하는 때 = ① 요청문·도구 명령에 그 문서 이름이 나왔을 때(AI 가 고치기 **전** 판) ② 캔버스가 그 판을 그렸을 때.
//   한도 = 문서마다 최근 10판 · 50MB 이하 파일 · 14일 · 모두 합쳐 500MB(오래된 것부터 지움). 내용이 같은 판은 한 번만.
//   되돌리기 = 지금 판을 먼저 보관한 뒤 임시 파일 → 이름 바꾸기(쓰는 중인 파일이면 손대지 않고 알린다).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isConvertible } from './doc2pdf.mjs';

const MAX_FILE = 50 * 1024 * 1024, MAX_PER_DOC = 10, MAX_DAYS = 14, MAX_TOTAL = 500 * 1024 * 1024;
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

export class DocVersions {
  constructor({ dir, log = () => {}, enabled = () => true, now = () => Date.now(), maxTotal = MAX_TOTAL }) { Object.assign(this, { dir, log, enabled, now, maxTotal }); }
  #home(file) { return path.join(this.dir, sha(path.resolve(file).toLowerCase())); }
  #meta(file) { try { const m = JSON.parse(fs.readFileSync(path.join(this.#home(file), 'meta.json'), 'utf8')); return Array.isArray(m.list) ? m : null; } catch { return null; } }
  #save(file, meta) { const h = this.#home(file); fs.mkdirSync(h, { recursive: true }); const t = path.join(h, 'meta.json.tmp'); fs.writeFileSync(t, JSON.stringify(meta), 'utf8'); fs.renameSync(t, path.join(h, 'meta.json')); }
  #blob(file, v) { return path.join(this.#home(file), `${v}${path.extname(file).toLowerCase()}`); }

  /** 지금 내용을 보관. → 판 번호(v) 또는 null(대상 아님·너무 큼·읽지 못함). pdf = 이미 변환해 둔 PDF(다시 변환하지 않게) */
  keep(file, pdf = null) {
    if (!this.enabled() || !isConvertible(file)) return null;
    try {
      const st = fs.statSync(file); if (!st.isFile() || st.size > MAX_FILE || !st.size) return null;
      const meta = this.#meta(file) || { path: path.resolve(file), list: [] }; const last = meta.list.at(-1);
      if (last && last.mtime === st.mtimeMs && last.size === st.size) { if (pdf && last.pdf !== pdf) { last.pdf = pdf; this.#save(file, meta); } return last.v; }
      const buf = fs.readFileSync(file); const v = sha(buf);
      const old = meta.list.find((x) => x.v === v); meta.list = meta.list.filter((x) => x.v !== v);
      meta.list.push({ v, mtime: st.mtimeMs, size: st.size, at: this.now(), pdf: pdf || old?.pdf || null });
      fs.mkdirSync(this.#home(file), { recursive: true });
      const blob = this.#blob(file, v); if (!fs.existsSync(blob)) { const t = `${blob}.tmp`; fs.writeFileSync(t, buf); fs.renameSync(t, blob); }
      while (meta.list.length > MAX_PER_DOC) { const x = meta.list.shift(); try { fs.rmSync(this.#blob(file, x.v), { force: true }); } catch {} }
      this.#save(file, meta); if (!old) this.sweep(); return v;
    } catch (e) { this.log(`docversions keep ${path.basename(file)}: ${e.message}`); return null; }
  }
  /** 요청문·도구 글에 나온 문서 이름들(있는 것만) */
  keepMentioned(cwd, names, skipDir = '') {
    let n = 0;
    for (const raw of (names || []).slice(0, 20)) {
      const w = String(raw).replace(/^file:\/\/\//i, '').replace(/^\/([A-Za-z])\//, '$1:\\').replace(/\//g, '\\');
      const f = /^[A-Za-z]:\\/.test(w) ? path.resolve(w) : cwd ? path.resolve(cwd, w) : null;
      if (!f || /[\\/]secrets[\\/]/i.test(f) || (skipDir && f.toLowerCase().startsWith(path.resolve(skipDir).toLowerCase()))) continue;
      if (this.keep(f)) n++;
    }
    return n;
  }
  /** 보관된 판들(오래된 것부터) + cur = 지금 파일과 같은 판 */
  list(file) {
    let st = null; try { st = fs.statSync(file); } catch {}
    const meta = this.#meta(file); if (!meta) return [];
    let cur = st && meta.list.find((x) => x.mtime === st.mtimeMs && x.size === st.size)?.v;
    if (!cur && st && st.size <= MAX_FILE && meta.list.some((x) => x.size === st.size)) { try { cur = sha(fs.readFileSync(file)); } catch {} }
    return meta.list.filter((x) => fs.existsSync(this.#blob(file, x.v))).map((x) => ({ v: x.v, mtime: x.mtime, size: x.size, cur: x.v === cur }));
  }
  /** 그 판의 사본 파일과 변환해 둔 PDF → { file, pdf|null } 또는 null */
  get(file, v) {
    const x = /^[0-9a-f]{16}$/.test(String(v)) && this.#meta(file)?.list.find((k) => k.v === v); if (!x) return null;
    const f = this.#blob(file, v); return fs.existsSync(f) ? { file: f, pdf: x.pdf && fs.existsSync(x.pdf) ? x.pdf : null, mtime: x.mtime } : null;
  }
  /** 그 판으로 되돌린다. 실패하면 한국어 이유로 throw(원본은 그대로). */
  restore(file, v) {
    const x = this.get(file, v); if (!x) throw new Error('이 판은 더 이상 보관되어 있지 않아요.');
    if (fs.existsSync(file) && !this.keep(file)) throw new Error('지금 판을 보관하지 못해 되돌리지 않았어요(파일이 50MB보다 크거나 읽을 수 없어요).');
    const back = this.get(file, v); if (!back) throw new Error('이 판은 더 이상 보관되어 있지 않아요.'); // 보관하다 한도로 밀려났을 때
    const t = `${file}.iris-${process.pid}.tmp`;
    try { fs.copyFileSync(back.file, t); const now = new Date(this.now()); fs.utimesSync(t, now, now); fs.renameSync(t, file); }
    catch (e) { try { fs.rmSync(t, { force: true }); } catch {} throw new Error(/EBUSY|EPERM|EACCES/.test(e.code || '') ? '다른 프로그램이 이 파일을 쓰는 중이라 되돌리지 못했어요. 그 창을 닫고 다시 해 주세요.' : `되돌리지 못했어요(${e.code || e.message}).`); }
    this.log(`docversions restore ${path.basename(file)} → ${v}`); this.keep(file); return true;
  }
  #homes() { try { return fs.readdirSync(this.dir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^[0-9a-f]{16}$/.test(e.name)).map((e) => path.join(this.dir, e.name)); } catch { return []; } }
  /** 14일 지난 판 · 전체 500MB 넘는 만큼(오래된 것부터) 지움. 우리가 만든 폴더만. */
  sweep() {
    const all = [];
    for (const h of this.#homes()) { try { const m = JSON.parse(fs.readFileSync(path.join(h, 'meta.json'), 'utf8')); for (const x of m.list) all.push({ h, x, ext: path.extname(m.path).toLowerCase() }); } catch {} }
    all.sort((a, b) => b.x.at - a.x.at); let sum = 0; const drop = new Map();
    for (const a of all) { sum += a.x.size; if (this.now() - a.x.at > MAX_DAYS * 86400000 || sum > this.maxTotal) (drop.get(a.h) || drop.set(a.h, []).get(a.h)).push(a); }
    for (const [h, list] of drop) {
      try {
        const f = path.join(h, 'meta.json'), m = JSON.parse(fs.readFileSync(f, 'utf8')); const gone = new Set(list.map((a) => a.x.v));
        m.list = m.list.filter((x) => !gone.has(x.v));
        for (const a of list) fs.rmSync(path.join(h, `${a.x.v}${a.ext}`), { force: true });
        if (m.list.length) fs.writeFileSync(f, JSON.stringify(m), 'utf8'); else fs.rmSync(h, { recursive: true, force: true });
      } catch {}
    }
    return drop.size;
  }
  /** 보관함 비우기(설정) → 지운 문서 수 */
  clear() { const hs = this.#homes(); for (const h of hs) { try { fs.rmSync(h, { recursive: true, force: true }); } catch {} } return hs.length; }
}
