// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// localchat.mjs — 로컬 AI 대화 프로그램(가상 터미널 안에서 돈다). 다른 CLI 와 같은 약속을 지켜 화면·판정을 그대로 쓴다:
//   빈 입력 줄 「❯」= 대기 · 「⠋ Generating...」= 작업 중(sessions.mjs SPINNER_RE) · 괄호 붙여넣기 + Enter = 보내기 · Esc = 멈춤
//   기록 = 클로드와 같은 모양의 JSONL 한 파일(transcript.mjs fromClaude 가 읽음). 파일·명령은 아무것도 하지 않는다.
// 사용: node localchat.mjs --model <이름> --session <uuid> --record <파일>
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chat, trimHistory, NAME_RE } from './localai.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
const model = arg('--model'), session = arg('--session'), record = arg('--record');
if (!NAME_RE.test(model) || !/^[0-9a-f-]{36}$/.test(session) || !record) { console.error('사용: localchat --model 이름 --session 번호 --record 파일'); process.exit(2); }
fs.mkdirSync(path.dirname(record), { recursive: true });

const history = [];
try { for (const l of fs.readFileSync(record, 'utf8').split('\n')) { if (!l.trim()) continue; const j = JSON.parse(l); const c = j.message?.content; const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : ''; 
  // 멈춘 요청·오류 난 요청은 이어 갈 때 앞 대화에서 뺀다(대화 중과 같게)
  if ((j.type === 'user' && /^\[Request interrupted/.test(t)) || (j.type === 'assistant' && t.startsWith('⚠ '))) { if (history.at(-1)?.role === 'user') history.pop(); continue; }
  if (t && (j.type === 'user' || j.type === 'assistant')) history.push({ role: j.type, content: t }); } } catch {}
const write = (type, message) => fs.appendFileSync(record, JSON.stringify({ type, uuid: randomUUID(), sessionId: session, timestamp: new Date().toISOString(), message }) + '\n', 'utf8');

const out = (s) => process.stdout.write(s);
const PROMPT = '\r\n❯ ';
let line = '', busy = null, pasting = false, pending = '';
out(`로컬 AI · ${model}\r\n이 컴퓨터 안에서만 대화합니다. 파일과 인터넷은 쓰지 않습니다.${history.length ? `\r\n앞 대화 ${history.length}개를 이어 갑니다.` : ''}\r\n${PROMPT}`);

async function ask(text) {
  const q = text.trim(); line = ''; if (!q) return out(PROMPT);
  if (q === '/exit') process.exit(0);
  write('user', { role: 'user', content: q }); history.push({ role: 'user', content: q });
  out('\x1b[2J\x1b[H'); // 보낸 글이 입력창에 남아 보이지 않게(sessions.mjs 의 전송 확인)
  const ac = new AbortController(); busy = ac; const t0 = Date.now(); let n = 0, k = 0; const F = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const draw = () => out(`\r\x1b[2K${F[k++ % F.length]} Generating... (${Math.round((Date.now() - t0) / 1000)}s · ${n}자 · Esc 로 멈춤)`); draw(); const timer = setInterval(draw, 200);
  let answer = '', err = '';
  try { answer = await chat({ model, messages: trimHistory(history), signal: ac.signal, onToken: (c) => { n = c; } }); }
  catch (e) { err = ac.signal.aborted ? 'stop' : e.cause?.code === 'ECONNREFUSED' || /fetch failed/.test(e.message) ? '로컬 AI 프로그램(Ollama)이 꺼져 있어요. Ollama 를 켠 뒤 다시 보내 주세요.' : e.message; }
  clearInterval(timer); busy = null; out('\r\x1b[2K');
  if (err === 'stop') { write('user', { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }); history.pop(); out('멈췄습니다.'); }
  else { const text2 = err ? `⚠ ${err}` : answer; write('assistant', { role: 'assistant', model, content: [{ type: 'text', text: text2 }] }); if (err) history.pop(); else history.push({ role: 'assistant', content: answer }); out(text2.replace(/\r?\n/g, '\r\n').split('\r\n').slice(-60).join('\r\n')); }
  out(`\r\n${PROMPT}`);
}
function key(ch) {
  if (ch === '\r' || ch === '\n') { if (!busy) ask(line); return; }
  if (ch === '\x7f' || ch === '\b') { if (!busy && line) { line = [...line].slice(0, -1).join(''); out(`\r\x1b[2K❯ ${line.split('\n').pop()}`); } return; }
  if (ch === '\x03') { if (busy) busy.abort(); else process.exit(0); return; }
  if (ch < ' ' || busy) return;
  line += ch; out(ch);
}
function feed(s) {
  pending += s;
  for (;;) {
    if (pasting) {
      const e = pending.indexOf('\x1b[201~');
      const body = e >= 0 ? pending.slice(0, e) : pending.slice(0, Math.max(0, pending.length - 6));
      if (body && !busy) { line += body.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f]/g, ''); }
      pending = pending.slice(body.length);
      if (e < 0) return;
      pending = pending.slice(6); pasting = false; if (!busy) out(`\r\x1b[2K❯ ${line.replace(/\n/g, ' ⏎ ').slice(0, 400)}`);
      continue;
    }
    if (!pending) return;
    if (pending.startsWith('\x1b[200~')) { pasting = true; pending = pending.slice(6); continue; }
    if (pending[0] === '\x1b') {
      if (pending === '\x1b') { setTimeout(() => { if (pending === '\x1b') { pending = ''; if (busy) busy.abort(); } }, 60); return; }
      if ('\x1b[200~'.startsWith(pending)) return; // 붙여넣기 머리가 덜 옴
      const m = /^\x1b\[[0-9;?]*[ -/]*[@-~]|^\x1bO.|^\x1b./.exec(pending); if (!m) return; if (m[0] === '\x1b\x1b' && busy) busy.abort(); pending = pending.slice(m[0].length); continue;
    }
    const ch = String.fromCodePoint(pending.codePointAt(0)); pending = pending.slice(ch.length); key(ch);
  }
}
process.stdin.setEncoding('utf8'); try { process.stdin.setRawMode?.(true); } catch {}
out('\x1b[?2004h'); process.stdin.on('data', feed); process.stdin.on('end', () => process.exit(0)); process.stdin.resume();
