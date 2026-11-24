// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// mcprun.mjs — 열쇠가 필요한 내 MCP 의 실행기: 저장해 둔 열쇠(mcpkeys.mjs)를 풀어 환경 변수로만 넘기고 진짜 명령을 띄운다.
// 사용(AI 설정 파일에 이렇게 적힘): node mcprun.mjs <MCP 이름>
import path from 'node:path';
import { spawn } from 'node:child_process';
import { McpKeys } from './mcpkeys.mjs';
import { soulRoot } from './paths.mjs';

const id = process.argv[2] || '';
let x = null;
try { if (/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) x = new McpKeys({ file: process.env.IRIS_MCP_KEYS_FILE || path.join(soulRoot(), '_agent', 'setup', 'mcp-keys.json') }).open(id); } catch { /* 값이 섞일 수 있어 오류 글을 그대로 찍지 않는다 */ }
if (!x) { console.error('[IRIS] 저장한 열쇠를 열지 못했어요. 설정 → 도구 → MCP 에서 열쇠를 다시 적어 주세요(다른 윈도 계정·다른 PC 에서는 열 수 없습니다).'); process.exit(1); }
const wrap = /^(npx|npm|pnpm|pnpx|yarn|bunx)$|\.(cmd|bat)$/i.test(x.command);
const child = spawn(wrap ? 'cmd' : x.command, wrap ? ['/c', x.command, ...x.args] : x.args, { stdio: 'inherit', windowsHide: true, env: { ...process.env, ...x.env } });
child.on('error', (e) => { console.error(`[IRIS] 실행하지 못했어요: ${e.code || 'error'}`); process.exit(1); });
child.on('exit', (code) => process.exit(code ?? 1));
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => { try { child.kill(); } catch {} });
