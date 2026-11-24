// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// migrate.mjs — 새 PC 로 옮기기(P18 2026-11-24 고도화 10번, 사용자 결정 = 암호 필수).
//   담는 것 = 설정 · 서식함 · 예약(꺼진 채로) · 볼 수 있는 대화 기록 · 내 폴더 지도(R/D/P 폴더와 안내 파일만, 작업 파일은 안 담음)
//   안 담는 것 = 로그인 열쇠 · MCP 열쇠 · 개인 공간 PIN · 남의(잠긴) 대화 · 첨부 · 미리보기. 새 PC 에서 한 번 로그인한다.
//   묶음 = 'IRISPK1' + 소금16 + 논스12 + 표16 + AES-256-GCM(zip). 열쇠 = scrypt(암호). 암호는 어디에도 남기지 않는다.
//   푸는 쪽은 있는 파일을 덮지 않고, 정해 둔 자리 밖(.. · 절대 경로)으로는 쓰지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { zipRead, zipWrite } from './zip.mjs';
import { claudeProjectSlug } from './agents.mjs';

const MAGIC = Buffer.from('IRISPK1');
const MAX_RECORDS = 300 * 1024 * 1024; // 대화 기록 합계(넘으면 오래된 것부터 빠짐)
const N = 1 << 15;
export const badPassword = (p) => (typeof p !== 'string' || [...p].length < 8 ? '암호는 8글자 이상으로 정해 주세요.' : '');
const keyOf = (pw, salt) => crypto.scryptSync(pw.normalize('NFC'), salt, 32, { N, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
export function lockPack(zip, pw) {
  const salt = crypto.randomBytes(16), nonce = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', keyOf(pw, salt), nonce); c.setAAD(MAGIC);
  const body = Buffer.concat([c.update(zip), c.final()]); return Buffer.concat([MAGIC, salt, nonce, c.getAuthTag(), body]);
}
export function openPack(buf, pw) {
  if (!Buffer.isBuffer(buf) || buf.length < 60 || !buf.subarray(0, 7).equals(MAGIC)) throw new Error('IRIS 옮기기 묶음이 아니에요.');
  try { const d = crypto.createDecipheriv('aes-256-gcm', keyOf(String(pw), buf.subarray(7, 23)), buf.subarray(23, 35)); d.setAAD(MAGIC); d.setAuthTag(buf.subarray(35, 51)); return Buffer.concat([d.update(buf.subarray(51)), d.final()]); }
  catch { throw new Error('암호가 다르거나 묶음이 손상됐어요.'); }
}
// 옮길 설정(이 PC 에 묶인 값·열쇠 관련은 뺌)
const SET_KEYS = ['theme', 'stage', 'density', 'pauseWhenDim', 'intro', 'sharePeople', 'privacyCheck', 'docVersions', 'fontScale', 'math', 'permission', 'approval', 'sandbox', 'notifyDone', 'notifyOs', 'autoResume', 'tplSeen'];
const GUIDE = /^(CLAUDE|AGENTS)\.md$/i, LEVEL = /^(〖[^〗]{1,30}〗 ?)?[RDPST]\d{2}(\.\d{2})?-.{1,80}$/;

/** 폴더 지도: R/D/P/S/T 폴더 이름과 안내 파일만(깊이 5, 2000개까지) */
export function folderMap(root, { max = 2000 } = {}) {
  const dirs = [], files = [];
  const walk = (dir, rel, d) => {
    if (d > 5 || dirs.length >= max) return; let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && !e.isSymbolicLink() && LEVEL.test(e.name)) { dirs.push(r); walk(path.join(dir, e.name), r, d + 1); }
      else if (rel && e.isFile() && GUIDE.test(e.name)) { try { const f = path.join(dir, e.name); if (fs.statSync(f).size < 200_000) files.push({ rel: r, data: fs.readFileSync(f) }); } catch {} }
    }
  };
  walk(root, '', 0); return { dirs, files };
}

/** → { file, name, count } — sessions = 볼 수 있는 세션 목록 */
export function makePack({ root, stateDir, sessions, parts, password, outDir = path.join(os.homedir(), 'Downloads'), codexHome, now = new Date() }) {
  const bad = badPassword(password); if (bad) throw new Error(bad);
  const E = [], add = (name, data) => E.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'), deflate: true }); const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf8')); } catch { return null; } };
  const count = { sessions: 0, skipped: 0, folders: 0 };
  if (parts.includes('settings')) {
    const s = read('settings.json') || {}; add('settings.json', JSON.stringify(Object.fromEntries(SET_KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]))));
    const t = read('templates.json'); if (t) add('templates.json', JSON.stringify(t));
    const c = read('schedules.json'); if (c?.list) add('schedules.json', JSON.stringify({ list: c.list.filter((x) => !x.owner).map(({ lastSession, handled, missedAt, lastAt, lastError, owner, ...x }) => ({ ...x, enabled: false })) }));
  }
  if (parts.includes('records')) {
    const metas = []; let sum = 0;
    const list = sessions.filter((r) => r.recordPath && fs.existsSync(r.recordPath)).map((r) => ({ r, st: fs.statSync(r.recordPath) })).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    for (const { r, st } of list) {
      if (sum + st.size > MAX_RECORDS || !r.sessionId || !/^[A-Za-z0-9-]{8,64}$/.test(r.sessionId)) { count.skipped++; continue; }
      sum += st.size; const rel = r.agent === 'codex' && codexHome ? path.relative(codexHome, r.recordPath).replace(/\\/g, '/') : '';
      add(`records/${r.agent}-${r.sessionId}.jsonl`, fs.readFileSync(r.recordPath));
      metas.push({ agent: r.agent, sessionId: r.sessionId, model: r.model, modelLabel: r.modelLabel, modelActual: r.modelActual, effort: r.effort, permission: r.permission, approval: r.approval, sandbox: r.sandbox, mode: r.mode, title: r.title, titleSource: r.titleSource === 'user' ? 'user' : 'ai', startedAt: r.startedAt, pinned: !!r.pinned, cwdRel: relIn(root, r.cwd), cwdName: path.basename(r.cwd || ''), ...(rel && /^sessions\/[\w/.-]+\.jsonl$/.test(rel) ? { rel } : {}) });
      count.sessions++;
    }
    add('sessions.json', JSON.stringify(metas));
  }
  if (parts.includes('folders')) { const m = folderMap(root); count.folders = m.dirs.length; add('folders.json', JSON.stringify(m.dirs)); for (const f of m.files) add(`folders/${f.rel}`, f.data); }
  if (!E.length) throw new Error('담을 것을 하나 이상 골라 주세요.');
  add('pack.json', JSON.stringify({ schema: 1, at: now.toISOString(), parts, count }));
  fs.mkdirSync(outDir, { recursive: true }); const p2 = (n) => String(n).padStart(2, '0'); const name0 = `IRIS 옮기기 ${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
  let file = path.join(outDir, `${name0}.irispack`); for (let n = 2; fs.existsSync(file); n++) file = path.join(outDir, `${name0} (${n}).irispack`);
  fs.writeFileSync(file, lockPack(zipWrite(E), password), { flag: 'wx' });
  return { file, name: path.basename(file), count };
}
function relIn(root, p) { const r = path.relative(root, p || ''); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.replace(/\\/g, '/') : r === '' ? '.' : null; }
/** 묶음 안 이름이 안전한 상대 경로인가 */
const safeRel = (r) => typeof r === 'string' && r.length < 400 && !/^[\\/]|^[A-Za-z]:|\0/.test(r) && r.split(/[\\/]/).every((s) => s && s !== '.' && s !== '..' && !/[<>:"|?*]/.test(s) && !/[. ]$/.test(s));

/** 묶음 풀기. addSession(rec) = 세션 카드를 목록에 더함(이미 있으면 false). 있던 것은 덮지 않는다. */
export function applyPack(buf, { password, root, stateDir, claudeDir, codexHome, settings, templates, addSession, home = os.homedir() }) {
  const zip = openPack(buf, password); const map = new Map(zipRead(zip, { maxEntryBytes: 512 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024, maxEntries: 20000 }).map((e) => [e.name, e.data]));
  const j = (n) => { try { return map.has(n) ? JSON.parse(map.get(n).toString('utf8')) : null; } catch { return null; } };
  if (j('pack.json')?.schema !== 1) throw new Error('이 판의 IRIS 가 읽을 수 없는 묶음이에요. IRIS 를 업데이트한 뒤 다시 해 주세요.');
  const out = { settings: false, templates: 0, schedules: 0, sessions: 0, sessionsHad: 0, folders: 0, foldersHad: 0 };
  const s = j('settings.json'); if (s && typeof s === 'object') { settings.set(Object.fromEntries(SET_KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]))); out.settings = true; }
  const t = j('templates.json'); if (Array.isArray(t?.list)) { const cur = templates.get(); const add = t.list.filter((x) => x?.name && x?.text && !cur.some((c) => c.name === x.name && c.text === x.text)); if (add.length) templates.set([...cur, ...add]); out.templates = add.length; }
  const dirs = j('folders.json');
  if (Array.isArray(dirs)) {
    for (const d of dirs.slice(0, 2000)) { if (!safeRel(d) || !d.split('/').every((x) => LEVEL.test(x))) continue; const p = path.join(root, ...d.split('/')); if (fs.existsSync(p)) { out.foldersHad++; continue; } fs.mkdirSync(p, { recursive: true }); out.folders++; }
    for (const [n, data] of map) { if (!n.startsWith('folders/')) continue; const r = n.slice(8); if (!safeRel(r) || !GUIDE.test(path.basename(r)) || !r.split('/').slice(0, -1).every((x) => LEVEL.test(x))) continue; const p = path.join(root, ...r.split('/')); if (!fs.existsSync(p) && fs.existsSync(path.dirname(p))) fs.writeFileSync(p, data, { flag: 'wx' }); }
  }
  const metas = j('sessions.json');
  for (const m of Array.isArray(metas) ? metas.slice(0, 5000) : []) {
    const data = map.get(`records/${m?.agent}-${m?.sessionId}.jsonl`);
    if (!data || !['claude', 'codex', 'gemini', 'local'].includes(m.agent) || !/^[A-Za-z0-9-]{8,64}$/.test(m.sessionId)) continue;
    let cwd = m.cwdRel === '.' ? root : m.cwdRel && safeRel(m.cwdRel) ? path.join(root, ...m.cwdRel.split('/')) : root; try { if (!fs.statSync(cwd).isDirectory()) cwd = root; } catch { cwd = root; }
    let file;
    if (m.agent === 'claude') file = path.join(claudeDir, 'projects', claudeProjectSlug(cwd), `${m.sessionId}.jsonl`);
    else if (m.agent === 'codex' && typeof m.rel === 'string' && safeRel(m.rel) && /^sessions\//.test(m.rel)) file = path.join(codexHome, ...m.rel.split('/'));
    else file = path.join(stateDir, m.agent === 'local' ? 'local-chats' : 'moved-records', `${m.agent === 'local' ? '' : `${m.agent}-`}${m.sessionId}.jsonl`);
    const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '');
    const rec = { cwd, agent: m.agent, model: str(m.model), modelLabel: str(m.modelLabel), modelActual: str(m.modelActual) || null, effort: str(m.effort, 12), permission: str(m.permission, 24), approval: str(m.approval, 24), sandbox: str(m.sandbox, 24), ...(m.agent === 'gemini' ? { mode: str(m.mode, 16) } : {}), sessionId: m.sessionId, recordPath: file, title: str(m.title, 60), titleSource: m.titleSource === 'user' ? 'user' : 'ai', startedAt: str(m.startedAt, 30) || new Date().toISOString(), pinned: !!m.pinned, moved: true };
    if (!addSession(rec)) { out.sessionsHad++; continue; }
    if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data, { flag: 'wx' }); }
    out.sessions++;
  }
  const c = j('schedules.json'); out.scheduleList = Array.isArray(c?.list) ? c.list.slice(0, 20) : [];
  return out;
}
