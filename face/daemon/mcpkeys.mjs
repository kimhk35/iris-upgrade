// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// mcpkeys.mjs — 내 MCP 의 비밀 열쇠 보관(P18 2026-11-24 고도화 12번). 윈도 DPAPI(이 윈도 계정에서만 풀림).
//   · 파일(_agent\setup\mcp-keys.json)에는 잠근 값과 실행 명령만. AI 설정 파일에는 실행기(mcprun.mjs <이름>)만 적힌다.
//   · 열쇠 값은 로그·화면·방송·명령줄 인자에 싣지 않는다(파워셸에는 표준 입력으로).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const KEY_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
// 프로그램의 동작 자체를 바꾸는 환경 변수는 열쇠로 받지 않는다(다른 코드를 끼워 넣을 수 있음)
const DENY_RE = /^(PATH|PATHEXT|COMSPEC|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|NODE_OPTIONS|NODE_PATH|NODE_.*CERTS?|NODE_TLS_.*|PYTHON(PATH|STARTUP|HOME|INSPECT|USERBASE).*|LD_.*|DYLD_.*|BASH_ENV|PERL5OPT|RUBYOPT|JAVA_TOOL_OPTIONS|GIT_(SSH|EXEC|CONFIG).*|NPM_CONFIG_.*|HTTPS?_PROXY|ALL_PROXY|ELECTRON_.*|IRIS_.*|CLAUDE.*|CODEX.*|ANTHROPIC_BASE_URL)$/i;
export function checkKeyName(n) { if (!KEY_NAME_RE.test(n)) return '열쇠 이름은 영어·숫자·밑줄이어야 합니다'; if (DENY_RE.test(n)) return `${n} 은(는) 열쇠로 쓸 수 없는 이름입니다`; return ''; }
/** 안내 글의 자리 표시(your-key, <TOKEN>, ${X}, xxx…)는 값이 아니라 빈칸으로 본다 */
export const isPlaceholder = (v) => { const s = String(v ?? '').trim(); return !s || /^(<.*>|\$\{?.*\}?|\{\{?.*\}?\}|%.*%|x{3,}|\*{3,}|\.{3,}|…+)$/i.test(s) || /^(your|my|insert|enter|paste|put|replace|여기|발급)[-_ ]?/i.test(s) || /(api|access|secret)?[-_ ]?(key|token)[-_ ]?here$/i.test(s); };

const PS = (body) => `$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.Encoding]::UTF8;[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false;Add-Type -AssemblyName System.Security;$in=[Console]::In.ReadToEnd();${body}`;
const LOCK = PS("$b=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($in),$null,'CurrentUser');[Console]::Out.Write([Convert]::ToBase64String($b))");
const OPEN = PS("$b=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in.Trim()),$null,'CurrentUser');[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))");
function ps(script, input) {
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { input, windowsHide: true, timeout: 30_000, encoding: 'utf8', maxBuffer: 1 << 22 });
  if (r.status !== 0) throw new Error('윈도 암호 보관 기능을 쓸 수 없어요.');
  return r.stdout;
}
export const dpapi = { lock: (s) => ps(LOCK, s), open: (s) => ps(OPEN, s) };

export class McpKeys {
  constructor({ file, crypt = dpapi }) { this.file = file; this.crypt = crypt; }
  #read() { try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); return j && j.schema === 1 && j.items ? j : { schema: 1, items: {} }; } catch { return { schema: 1, items: {} }; } }
  #write(j) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const t = `${this.file}.tmp`; fs.writeFileSync(t, JSON.stringify(j, null, 2), 'utf8'); fs.renameSync(t, this.file); }
  /** 그 MCP 의 실행 명령과 열쇠를 저장(있으면 바꿈). 값은 통째로 한 번에 잠근다. */
  set(id, { command, args = [] }, keys) { const j = this.#read(); j.items[id] = { command, args, names: Object.keys(keys).sort(), box: this.crypt.lock(JSON.stringify(keys)) }; this.#write(j); }
  /** 열쇠 값 하나 바꾸기 */
  change(id, name, value) { const j = this.#read(), x = j.items[id]; if (!x || !x.names.includes(name)) throw new Error('저장한 열쇠를 찾을 수 없어요.'); const k = JSON.parse(this.crypt.open(x.box)); k[name] = value; x.box = this.crypt.lock(JSON.stringify(k)); this.#write(j); }
  names(id) { return this.#read().items[id]?.names || []; }
  ids() { return Object.keys(this.#read().items); }
  has(id) { return !!this.#read().items[id]; }
  remove(id) { const j = this.#read(); if (!j.items[id]) return false; delete j.items[id]; this.#write(j); return true; }
  /** 실행기만 쓴다: 명령과 풀린 열쇠 */
  open(id) { const x = this.#read().items[id]; if (!x) return null; return { command: x.command, args: x.args, env: JSON.parse(this.crypt.open(x.box)) }; }
}
