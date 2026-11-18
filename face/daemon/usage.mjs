// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// 이 PC 사용량(P18, 2026-11-12 사용자 요청 「공유 계정에서 사용량을 서로 깎아 먹음」 조각 B):
// 구독 계정 하나를 여러 PC 가 나눠 쓸 때 "이 PC 가 오늘·이번 주 얼마나 썼나"를 이 PC 의 기록 파일만으로 센다(서버 접촉 0).
//   요청 = 사람이 보낸 차례(클로드 user 글 · 코덱스 user_message) · 양 = 토큰(들어간 것 + 나온 것, 캐시에서 다시 읽은 것은 뺌).
//   클로드 = <CLAUDE_CONFIG_DIR>\projects\**\*.jsonl(같은 응답이 여러 줄에 같은 usage 로 나뉘어 적히므로 message.id 로 한 번만),
//   코덱스 = <CODEX_HOME>\sessions\**\*.jsonl(token_count 의 last_token_usage 를 더함, cached_input_tokens 는 뺌).
//   최근 8일 안에 바뀐 파일만 읽고, 파일마다 (크기·시각)이 같으면 이전 결과를 다시 쓴다.
import fs from 'node:fs';
import path from 'node:path';

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
/** 그 PC 의 지역 날짜 'YYYY-MM-DD' */
export const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function walk(dir, out, since, depth = 0) {
  if (depth > 6) return;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'subagents') walk(p, out, since, depth + 1); }
    else if (e.isFile() && e.name.endsWith('.jsonl')) { try { const st = fs.statSync(p); if (st.mtimeMs >= since) out.push({ p, st }); } catch {} }
  }
}

/** 기록 파일 하나(또는 그 뒷부분) → { 'YYYY-MM-DD': { requests, tokens } }. days·seen 을 넘기면 거기에 이어 더한다(늘어난 부분만 읽을 때). */
export function summarizeFile(text, kind, days = {}, seen = new Set()) {
  const add = (ms, r, t) => { if (!Number.isFinite(ms)) return; const k = dayKey(ms); const b = days[k] ||= { requests: 0, tokens: 0 }; b.requests += r; b.tokens += t; };
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const ms = Date.parse(j.timestamp || j.ts || '');
    if (kind === 'claude') {
      if (j.type === 'user' && !j.isMeta && !j.isSidechain) {
        const c = j.message?.content;
        const real = typeof c === 'string' ? !/^<(command|local-command|task-notification)/.test(c.trim()) : Array.isArray(c) && c.some((b) => b?.type === 'text') && !c.some((b) => b?.type === 'tool_result');
        if (real) add(ms, 1, 0);
      } else if (j.type === 'assistant' && j.message?.usage) {
        const id = j.message.id || j.uuid; if (id && seen.has(id)) continue; if (id) seen.add(id);
        const u = j.message.usage;
        add(ms, 0, (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0));
      }
    } else {
      const p = j.payload || {};
      if (j.type === 'event_msg' && p.type === 'user_message') add(ms, 1, 0);
      else if (j.type === 'event_msg' && p.type === 'token_count') {
        const u = p.info?.last_token_usage; if (u) add(ms, 0, Math.max(0, (u.input_tokens || 0) - (u.cached_input_tokens || 0)) + (u.output_tokens || 0));
      }
    }
  }
  return days;
}

export class LocalUsage {
  constructor({ claudeDir, codexHome, now = () => Date.now() }) { Object.assign(this, { claudeDir, codexHome, now }); this.cache = new Map(); this.last = null; this.lastAt = 0; }
  /** { today:{requests,tokens}, week:{…}(오늘 포함 7일), days:[{day,requests,tokens}] } — 30초 안에는 지난 결과 */
  get({ force = false } = {}) {
    const now = this.now();
    if (!force && this.last && now - this.lastAt < 30000) return this.last;
    const since = now - 8 * DAY, files = [], live = new Set();
    if (this.claudeDir) walk(path.join(this.claudeDir, 'projects'), files, since);
    const nClaude = files.length;
    if (this.codexHome) walk(path.join(this.codexHome, 'sessions'), files, since);
    const total = {};
    files.forEach(({ p, st }, i) => {
      live.add(p);
      // 기록 파일은 뒤로만 자란다 — 커졌으면 늘어난 부분만 읽어 이어 더하고(완성된 줄까지만), 줄었거나 처음이면 처음부터
      const kind = i < nClaude ? 'claude' : 'codex'; let c = this.cache.get(p);
      if (!c || st.size < c.offset) c = { offset: 0, days: {}, seen: new Set() };
      if (st.size > c.offset) {
        try {
          const fd = fs.openSync(p, 'r'); const buf = Buffer.alloc(st.size - c.offset); fs.readSync(fd, buf, 0, buf.length, c.offset); fs.closeSync(fd);
          const end = buf.lastIndexOf(0x0a) + 1; // 마지막 줄바꿈까지만(쓰는 중인 반쪽 줄은 다음에)
          if (end > 0) { summarizeFile(buf.subarray(0, end).toString('utf8'), kind, c.days, c.seen); c.offset += end; }
        } catch {}
      }
      this.cache.set(p, c);
      for (const [d, b] of Object.entries(c.days)) { const t = total[d] ||= { requests: 0, tokens: 0 }; t.requests += b.requests; t.tokens += b.tokens; }
    });
    for (const p of this.cache.keys()) if (!live.has(p)) this.cache.delete(p);
    const days = []; for (let i = 6; i >= 0; i--) { const d = dayKey(now - i * DAY); days.push({ day: d, ...(total[d] || { requests: 0, tokens: 0 }) }); }
    const week = days.reduce((a, b) => ({ requests: a.requests + b.requests, tokens: a.tokens + b.tokens }), { requests: 0, tokens: 0 });
    this.last = { today: { requests: days[6].requests, tokens: days[6].tokens }, week, days, files: files.length, at: now }; this.lastAt = now;
    return this.last;
  }
}
