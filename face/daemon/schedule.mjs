// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// schedule.mjs — 예약 실행(P18 2026-11-24 고도화 9번, 사용자 결정 = 작업 폴더의 파일 만들기·고치기까지).
//   · IRIS 가 켜져 있을 때만. 꺼져 있어 놓친 것은 저절로 돌리지 않고 「놓친 예약」으로 남겨 화면이 묻는다.
//   · 정해진 때마다 새 대화 하나. 앞 예약 대화가 아직 일하는 중이면 겹쳐 열지 않는다.
//   · 권한은 여기서 정한다(화면 설정을 따르지 않음): 클로드 acceptEdits · 코덱스 작업 폴더 쓰기 + 필요하면 묻기 · 제미나이 accept-edits.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const SAFE = { permission: 'acceptEdits', approval: 'on-request', sandbox: 'workspace-write', mode: 'accept-edits' };
const AGENTS = new Set(['claude', 'codex', 'gemini', 'local']);
const LATE_MS = 10 * 60_000; // 이만큼 늦으면(절전·꺼짐) 저절로 돌리지 않고 놓친 것으로
const MAX = 20;

/** from 뒤의 첫 예정 시각(ms). days = 요일 목록(0=일), 빈 목록 = 매일 */
export function nextAt(s, from) {
  const [h, m] = s.time.split(':').map(Number); const d = new Date(from);
  for (let i = 0; i <= 8; i++) { const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, h, m, 0, 0); if (t.getTime() > from && (!s.days.length || s.days.includes(t.getDay()))) return t.getTime(); }
  return null;
}
/** 받은 값 다듬기 → { item } 또는 { error } */
export function clean(x, { exists = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } } } = {}) {
  const name = String(x?.name || '').replace(/\s+/g, ' ').trim().slice(0, 40), prompt = String(x?.prompt || '').replace(/\r\n/g, '\n').trim().slice(0, 8000), cwd = String(x?.cwd || '').trim();
  if (!name) return { error: '이름을 적어 주세요.' }; if (!prompt) return { error: '보낼 요청을 적어 주세요.' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x?.time))) return { error: '시각을 정해 주세요.' };
  if (!AGENTS.has(x?.agent)) return { error: 'AI 를 골라 주세요.' };
  if (!/^[A-Za-z]:[\\/]/.test(cwd) || !exists(cwd)) return { error: '작업 폴더를 찾을 수 없어요.' };
  if (/^[A-Za-z]:[\\/]?$/.test(cwd) || /^[A-Za-z]:[\\/](windows|program files|program files \(x86\)|programdata)([\\/]|$)/i.test(cwd)) return { error: '드라이브 전체나 시스템 폴더는 쓸 수 없어요.' };
  const days = [...new Set((Array.isArray(x?.days) ? x.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return { item: { name, prompt, cwd, time: x.time, days: days.length === 7 ? [] : days, agent: x.agent, model: String(x?.model || '').slice(0, 80), effort: String(x?.effort || '').slice(0, 12), enabled: x?.enabled !== false } };
}

export class Scheduler {
  /** run(item) → 세션 { id } · busy(id) → 그 세션이 아직 일하는 중인가 · ready(agent) → 중계기가 준비됐나 */
  constructor({ file, run, busy = () => false, ready = async () => true, broadcast = () => {}, log = () => {}, now = () => Date.now() }) {
    Object.assign(this, { file, run, busy, ready, broadcast, log, now }); this.timer = null; this.ticking = false;
    try { this.list = JSON.parse(fs.readFileSync(file, 'utf8')).list || []; } catch { this.list = []; }
  }
  #save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const t = `${this.file}.tmp`; fs.writeFileSync(t, JSON.stringify({ list: this.list }, null, 2), 'utf8'); fs.renameSync(t, this.file); }
  #changed() { this.#save(); this.broadcast({ type: 'schedule' }); }
  #see(owner) { return this.list.filter((s) => (s.owner || null) === (owner || null)); }
  /** 그 공간(개인 공간)의 예약만 */
  info(owner = null) { return this.#see(owner).map((s) => ({ id: s.id, name: s.name, prompt: s.prompt, cwd: s.cwd, time: s.time, days: s.days, agent: s.agent, model: s.model, effort: s.effort, enabled: s.enabled, next: s.enabled ? nextAt(s, this.now()) : null, missedAt: s.missedAt || null, lastAt: s.lastAt || null, lastError: s.lastError || null })); }
  upsert(x, owner = null) {
    const { item, error } = clean(x); if (error) throw new Error(error);
    const old = x.id ? this.#see(owner).find((s) => s.id === x.id) : null; if (x.id && !old) throw new Error('예약을 찾을 수 없어요.');
    if (old) { const moved = old.time !== item.time || String(old.days) !== String(item.days) || (!old.enabled && item.enabled); Object.assign(old, item); if (moved) { old.handled = this.now(); old.missedAt = null; } old.lastError = null; }
    else { if (this.list.length >= MAX) throw new Error(`예약은 ${MAX}개까지 만들 수 있어요.`); this.list.push({ id: randomUUID(), ...item, owner, handled: this.now() }); } // 만든 뒤의 첫 예정부터
    this.#changed();
  }
  remove(id, owner = null) { const n = this.list.length; this.list = this.list.filter((s) => !(s.id === id && (s.owner || null) === (owner || null))); if (this.list.length !== n) this.#changed(); }
  async #fire(s) {
    s.missedAt = null;
    if (s.lastSession && this.busy(s.lastSession)) { s.lastError = '앞 예약이 아직 일하는 중이라 이번은 건너뛰었어요.'; return this.#changed(); }
    try {
      for (let i = 0; i < 12 && !(await this.ready(s.agent)); i++) await new Promise((r) => setTimeout(r, 5000));
      const rec = await this.run(s); s.lastSession = rec.id; s.lastAt = this.now(); s.lastError = null; this.log(`schedule run ${s.name} → ${rec.id}`);
    } catch (e) { s.lastError = `시작하지 못했어요: ${e.message}`; this.log(`schedule ${s.name}: ${e.message}`); }
    this.#changed();
  }
  /** 30초마다: 예정 시각이 지났으면 돌리거나(10분 안) 놓친 것으로 남긴다 */
  async tick() {
    if (this.ticking) return; this.ticking = true;
    try {
      for (const s of [...this.list]) {
        if (!s.enabled) continue;
        const now = this.now(); let due = nextAt(s, s.handled || now), last = null;
        while (due && due <= now) { last = due; due = nextAt(s, due); }
        if (!last) continue;
        s.handled = last;
        if (now - last <= LATE_MS) await this.#fire(s); else { s.missedAt = last; this.#changed(); }
      }
    } finally { this.ticking = false; }
  }
  /** 화면이 고른 대로: 놓친 것을 지금 하거나 건너뜀 · 지금 바로 해 보기 */
  async answer(id, go, owner = null) { const s = this.#see(owner).find((x) => x.id === id); if (!s) throw new Error('예약을 찾을 수 없어요.'); if (go) return this.#fire(s); s.missedAt = null; this.#changed(); }
  start(ms = 30_000) { this.timer = setInterval(() => this.tick().catch(() => {}), ms); this.timer.unref?.(); setTimeout(() => this.tick().catch(() => {}), 15_000).unref?.(); }
}
