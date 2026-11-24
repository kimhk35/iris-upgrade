// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// search.mjs — 지난 대화 검색(P18 2026-11-24). 이미 읽어 둔 기록 항목(요청·답)에서만 찾는다 — 도구 출력·생각은 빼고, 바깥 연결 0.
// 여러 낱말 = 한 글에 모두 들어 있어야(제목은 제목끼리). 대소문자 구분 없음, 한글은 완성형(NFC)으로 맞춘다.
import path from 'node:path';

const norm = (s) => String(s ?? '').normalize('NFC');
export const wordsOf = (q) => [...new Set(norm(q).toLowerCase().trim().split(/\s+/).filter(Boolean))].slice(0, 8);

/** 찾은 낱말 둘레만 한 줄로(앞뒤 잘린 표시 …) */
export function snippet(text, words, len = 130) {
  const s = norm(text).replace(/\s+/g, ' ').trim(); const low = s.toLowerCase();
  const at = Math.min(...words.map((w) => low.indexOf(w)).filter((k) => k >= 0), s.length);
  const a = Math.max(0, Math.min(at - 36, s.length - len)); const b = Math.min(s.length, a + len);
  return `${a > 0 ? '…' : ''}${s.slice(a, b)}${b < s.length ? '…' : ''}`;
}

/**
 * @param sessions [{ rec, items }] 볼 수 있는 대화만(개인 공간 검사는 호출부)
 * @returns { total, sessions:[{ id, title, agent, folder, t, hits:[{ i, t, kind, text }], more }] } 최근에 나온 것부터
 */
export function searchSessions(sessions, q, { agent = '', maxSessions = 40, maxHits = 3 } = {}) {
  const words = wordsOf(q); if (!words.length || words.join('').length < 2) return { total: 0, sessions: [] };
  const has = (s) => { const low = norm(s).toLowerCase(); return words.every((w) => low.includes(w)); };
  const out = [];
  for (const { rec, items } of sessions) {
    if (agent && rec.agent !== agent) continue;
    const hits = []; let count = 0;
    for (let k = (items || []).length - 1; k >= 0; k--) {
      const it = items[k];
      if ((it.kind !== 'user' && it.kind !== 'assistant') || !it.text || !has(it.text)) continue;
      count++; if (hits.length < maxHits) hits.push({ i: it.i, t: it.t || null, kind: it.kind, text: snippet(it.text, words) });
    }
    if (!count && !has(rec.title || '')) continue;
    out.push({ id: rec.id, title: rec.title || '', agent: rec.agent, folder: path.basename(String(rec.cwd || '')) || String(rec.cwd || ''), t: hits[0]?.t || rec.createdAt || null, hits, more: count - hits.length });
  }
  out.sort((a, b) => (Date.parse(b.t || '') || 0) - (Date.parse(a.t || '') || 0));
  return { total: out.length, sessions: out.slice(0, maxSessions) };
}
