// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// localai.mjs — 로컬 AI(Ollama) 목록과 대화 요청(P18 2026-11-24 고도화 11번, 대화 전용).
//   · 이 PC 의 Ollama(127.0.0.1:11434)만 쓴다 — OLLAMA_HOST 가 다른 컴퓨터를 가리켜도 따르지 않는다(글이 밖으로 나가지 않게).
//   · Ollama 의 클라우드 모델(이름 -cloud/:cloud, remote_host·remote_model 이 있는 것)은 남의 서버에서 돌므로 목록에서 뺀다.
export const OLLAMA = process.env.IRIS_OLLAMA_URL && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(process.env.IRIS_OLLAMA_URL) ? process.env.IRIS_OLLAMA_URL : 'http://127.0.0.1:11434';
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,80}(:[A-Za-z0-9._-]{1,60})?$/;
const isCloud = (m) => /(^|[-:])cloud$/i.test(m.name) || !!m.remote_host || !!m.remote_model;
const isEmbed = (m) => /embed|bge-|minilm|rerank/i.test(m.name) || /bert/i.test(m.details?.family || '');

/** Ollama 가 준 목록 → 고를 수 있는 모델 [{ id, label, actual }] (작은 것부터) */
export function modelsFromTags(j) {
  return (Array.isArray(j?.models) ? j.models : []).filter((m) => NAME_RE.test(String(m?.name || '')) && !isCloud(m) && !isEmbed(m))
    .sort((a, b) => (a.size || 0) - (b.size || 0)).map((m) => { const id = m.name.replace(/:latest$/, ''); return { id: m.name, label: `${id}${m.size ? ` · ${(m.size / 1e9).toFixed(1)}GB` : ''}`, actual: m.name, size: m.size || 0 }; });
}
export async function listModels({ url = OLLAMA, timeoutMs = 1500 } = {}) {
  try { const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) }); return r.ok ? modelsFromTags(await r.json()) : []; } catch { return []; }
}
/** 8GB 그래픽에서 무난한 크기(2~6GB)를 기본으로 — 없으면 가장 작은 것 */
export const defaultModel = (list) => (list.find((m) => /^(qwen|gemma)/.test(m.id) && m.size >= 2e9 && m.size <= 6e9) || list.find((m) => m.size >= 2e9 && m.size <= 6e9) || list[0])?.id || '';

/** 한국어 요청에 다른 글자(한자·가나·로마자)로만 답했는가 — 작은 모델이 가끔 중국어로 답한다(2026-11-24 실측) */
export function wrongLanguage(question, answer) {
  const n = (s, r) => (String(s).match(r) || []).length, ko = /[가-힣]/g, han = /[\u4e00-\u9fff\u3040-\u30ff]/g;
  const prose = String(answer).replace(/```[\s\S]*?```/g, ''); // 코드는 뺀다
  if (n(question, ko) < 4 || n(question, han) > 3 || /영어|영문|중국어|일본어|한문|번역/.test(question)) return false;
  return n(prose, han) > 8 && n(prose, han) > n(prose, ko) || (n(prose, ko) === 0 && n(prose, /[A-Za-z]/g) > 40);
}
export const SYSTEM = '반드시 한국어로만 답합니다. 중국어로 답하지 않습니다. 당신은 교사를 돕는 한국어 글쓰기·대화 도우미입니다. 글을 쓰고, 다듬고, 요약하고, 설명하는 부탁은 거절하지 말고 바로 결과를 보여 주세요. 사람 이름이나 번호가 나와도 사용자의 컴퓨터 안에서만 쓰이니 그대로 도와주세요. 답은 또렷하고 짧게 합니다. 다만 컴퓨터의 파일을 직접 열거나 저장하는 일과 인터넷 검색은 할 수 없으니, 그런 부탁에만 할 수 없다고 말하고 IRIS 의 다른 AI 를 권하세요. 모르는 것은 모른다고 하세요.';
const strip = (s) => String(s || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

/** 대화 한 차례. messages = [{role,content}], onToken(지금까지 글자 수). signal 로 멈춤. → 답 글 */
export async function chat({ model, messages, url = OLLAMA, signal, onToken = () => {}, numCtx = 8192 }) {
  const once = async (extra) => fetch(`${url}/api/chat`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: SYSTEM }, ...messages], options: { num_ctx: numCtx }, ...extra }) });
  let r = await once({ think: false });
  if (r.status === 400) { const t = await r.text(); if (!/think/i.test(t)) throw new Error(errText(t)); r = await once({}); } // 생각 끄기를 모르는 모델
  if (!r.ok) throw new Error(errText(await r.text()));
  let out = '', buf = ''; const dec = new TextDecoder();
  for await (const c of r.body) {
    buf += dec.decode(c, { stream: true }); const ls = buf.split('\n'); buf = ls.pop();
    for (const l of ls) { if (!l.trim()) continue; let j; try { j = JSON.parse(l); } catch { continue; } if (j.error) throw new Error(errText(j.error)); out += j.message?.content || ''; onToken(out.length); }
  }
  const a = strip(out); if (!a) throw new Error('모델이 빈 답을 냈어요. 다시 보내거나 다른 모델을 골라 주세요.');
  return a;
}
function errText(t) {
  let m = String(t); try { m = JSON.parse(m).error || m; } catch {}
  if (/not found/i.test(m)) return '이 모델이 컴퓨터에서 지워졌어요. 다른 모델을 골라 주세요.';
  if (/memory|VRAM/i.test(m)) return '메모리가 모자라 이 모델을 켜지 못했어요. 더 작은 모델을 골라 주세요.';
  return `로컬 AI 오류: ${m.slice(0, 160)}`;
}
/** 앞 대화를 글자 한도 안에서 뒤에서부터(요청·답 짝을 유지) */
export function trimHistory(list, limit = 14000) {
  const out = []; let n = 0;
  for (let i = list.length - 1; i >= 0; i--) { n += list[i].content.length; if (n > limit && out.length) break; out.unshift(list[i]); }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
