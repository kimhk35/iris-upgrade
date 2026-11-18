import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Task 9's two "outer shell" files must be readable and executable on a
// bare, freshly-imaged Windows PC with only its OEM code page installed --
// no UTF-8 console, no BOM assumptions. Non-ASCII bytes in either file
// (accidental curly quotes, an em dash, a stray Korean character pasted
// into a comment) risk mangled output or, worse, a broken script.
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CMD_PATH = path.join(ROOT_DIR, 'installer', 'IRIS-설치.cmd');
const PS1_PATH = path.join(ROOT_DIR, 'installer', 'bootstrap.ps1');

const cmdText = fs.readFileSync(CMD_PATH, 'utf8');
const ps1Text = fs.readFileSync(PS1_PATH, 'utf8');

test('the .cmd launcher file content is ASCII only (the filename itself is Korean)', () => {
  const hits = cmdText.match(/[^\x00-\x7F]/g);
  assert.deepEqual(hits, null, `non-ASCII byte(s) found in the .cmd launcher: ${JSON.stringify(hits)}`);
});

test('bootstrap.ps1 is ASCII only', () => {
  const hits = ps1Text.match(/[^\x00-\x7F]/g);
  assert.deepEqual(hits, null, `non-ASCII byte(s) found in bootstrap.ps1: ${JSON.stringify(hits)}`);
});

// Working-tree fix (Task 9 review finding #1): both files must be CRLF on
// disk, not just CRLF-on-checkout via .gitattributes (which only re-hydrates
// on a fresh `git checkout`, not on a working tree that predates the
// attribute). A file with zero bare `\n` (every `\n` is part of a `\r\n`
// pair) and at least one `\r\n` is unambiguously CRLF-only.
function assertCRLFOnly(text, label) {
  assert.ok(/\r\n/.test(text), `${label}: expected at least one CRLF line ending`);
  const bareLf = text.replace(/\r\n/g, '').match(/\n/g);
  assert.deepEqual(bareLf, null, `${label}: found bare LF line ending(s) not paired with CR`);
}

test('the .cmd launcher is CRLF only in the working tree', () => {
  assertCRLFOnly(cmdText, 'IRIS-설치.cmd');
});

test('bootstrap.ps1 is CRLF only in the working tree', () => {
  assertCRLFOnly(ps1Text, 'bootstrap.ps1');
});

test('bootstrap.ps1 exits 10/11/12/13 for its four failure stages', () => {
  for (const code of [10, 11, 12, 13]) {
    assert.match(ps1Text, new RegExp(`exit ${code}\\b`), `bootstrap.ps1 missing "exit ${code}"`);
  }
});

test('bootstrap.ps1 also has the success exit 0', () => {
  assert.match(ps1Text, /exit 0\b/);
});

test('the .cmd launcher runs bootstrap.ps1 with -ExecutionPolicy Bypass', () => {
  assert.match(cmdText, /-ExecutionPolicy Bypass/);
  assert.match(cmdText, /installer\\bootstrap\.ps1/);
});

test('the .cmd launcher only pauses on failure, not on the happy path', () => {
  // The brief's design: pause() must appear inside the `if errorlevel 1`
  // block, not unconditionally after it -- a successful run should close
  // the window (or leave it to the browser flow) without blocking on a
  // keypress.
  // Non-greedy up to a line that is just a closing paren -- the block's
  // own body contains a literal ")" (in "(code %errorlevel%)"), so a naive
  // ([\s\S]*?)\) would close too early on that inner parenthesis.
  const errorBlockMatch = cmdText.match(/if errorlevel 1 \(([\s\S]*?)\n\)/);
  assert.ok(errorBlockMatch, 'the .cmd launcher is missing an "if errorlevel 1 ( ... )" block');
  assert.match(errorBlockMatch[1], /pause/);
  const beforeBlock = cmdText.slice(0, errorBlockMatch.index);
  assert.doesNotMatch(beforeBlock, /pause/, 'pause must not appear before the failure check');
});

// Fix round 1 finding #5 (regression): a literal, unescaped "(" or ")" inside
// the "if errorlevel 1 ( ... )" block body breaks cmd.exe's paren-counting
// block parser -- observed live as exit code 255 and a garbled
// "'.' was unexpected at this time." instead of the intended message+pause,
// on every failure path (exit 10/11/12/13 all route through this block).
// The failure message's "(code %errorlevel%)" must use caret-escaped
// "^(...^)" so cmd.exe treats them as literal text, not block delimiters.
test('the .cmd launcher escapes literal parens inside the errorlevel block', () => {
  const errorBlockMatch = cmdText.match(/if errorlevel 1 \(([\s\S]*?)\n\)/);
  assert.ok(errorBlockMatch, 'the .cmd launcher is missing an "if errorlevel 1 ( ... )" block');
  const body = errorBlockMatch[1];
  assert.match(body, /\^\(code %errorlevel%\^\)/, 'expected caret-escaped ^(code %errorlevel%^)');
  // No OTHER unescaped paren should sneak into the block body either: every
  // "(" or ")" in the body must be immediately preceded by a caret.
  const unescaped = body.match(/(?<!\^)[()]/g);
  assert.deepEqual(unescaped, null, `found unescaped paren(s) in the errorlevel block: ${JSON.stringify(unescaped)}`);
});

// Fix round 1 finding #2: a server from a previous run must not be started
// a second time (it would fail to bind the port while the health probe
// keeps answering against the old one, clobbering server.pid with a dead
// pid). bootstrap.ps1 must probe the health endpoint, verify it is *our*
// server via the "name":"iris-installer" field (Task 10's server.mjs
// contract), reuse it and exit 0 if so, and otherwise stop only the exact
// pid recorded in server.pid -- never by process name or a port scan.
test('bootstrap.ps1 checks for and reuses an already-running iris-installer server', () => {
  assert.match(ps1Text, /iris-installer/, 'missing the "name":"iris-installer" health-body contract check');
  assert.match(ps1Text, /already running/i);
});

test('bootstrap.ps1 stops a stale server by its recorded pid only, never by name or port', () => {
  assert.match(ps1Text, /Stop-Process\s+-Id\s+\$stalePid/, 'missing Stop-Process -Id on the recorded stale pid');
  assert.doesNotMatch(ps1Text, /Stop-Process[^\n]*-Name/i, 'must never stop a process by name');
  assert.doesNotMatch(ps1Text, /taskkill/i, 'must never shell out to taskkill');
  assert.doesNotMatch(ps1Text, /Get-NetTCPConnection|netstat/i, 'must never scan the port to find a process to kill');
});

// 2026-09-12 final review I6: a recorded pid is not proof of identity. Pids
// are recycled and server.pid can outlive its process, so the recorded pid
// must be checked to still BE our bundled Node server before it is stopped --
// otherwise the installer can kill an unrelated process (an agent session, a
// relay, an editor) that happens to have inherited the number.
test('bootstrap.ps1 verifies the stale pid is our bundled node before stopping it', () => {
  // The whole stop must live inside an identity gate...
  const gate = ps1Text.match(/if \(\$isOurs\) \{([\s\S]*?)\n {6}\} else \{/);
  assert.ok(gate, 'Stop-Process is not guarded by an $isOurs identity check');
  assert.match(gate[1], /Stop-Process\s+-Id\s+\$stalePid/);
  // ...and that gate must test both the process name and, when readable, the
  // image path against the bundled node.exe this installer unpacks.
  assert.match(ps1Text, /\$staleProc\.ProcessName\s+-eq\s+'node'/, 'missing ProcessName -eq node check');
  assert.match(ps1Text, /\$stalePath\s+-eq\s+\$nodeExe/, 'missing image-path equality check against the bundled node.exe');
  assert.match(ps1Text, /\$nodeExe = Join-Path \$nodeDir 'node\.exe'/, 'bundled node.exe path must be resolved before the check');
  // A pid that fails the gate must be left alone (and said so in the log).
  assert.match(ps1Text, /not our bundled Node server\. Leaving it alone\./);
});

// Re-review residual (2026-09-12): an unreadable/absent $staleProc.Path used
// to leave $isOurs at the name-only result, so an unrelated node.exe this
// user cannot query was still stopped BY NAME -- exactly what the global rule
// forbids. Unknown identity must mean "not ours".
test('bootstrap.ps1: an unreadable stale-pid Path means "not ours" (never stop by name alone)', () => {
  // $isOurs starts false and the ONLY thing that can make it true is the
  // image-path equality, reached only when the name matches AND the path was
  // readable.
  assert.match(ps1Text, /\$isOurs = \$false/, '$isOurs must start out false');
  const trueAssignments = (ps1Text.match(/\$isOurs\s*=\s*[^\r\n]+/g) ?? [])
    .filter((line) => line !== '$isOurs = $false');
  assert.deepEqual(
    trueAssignments, ['$isOurs = ($stalePath -eq $nodeExe)'],
    'the bundled-path comparison must be the only assignment that can set $isOurs true',
  );
  assert.match(
    ps1Text,
    /if \(\(\$staleProc\.ProcessName -eq 'node'\) -and \$stalePath\) \{\r?\n\s*\$isOurs = \(\$stalePath -eq \$nodeExe\)/,
    'the path comparison must be guarded by BOTH the node name and a readable path',
  );
  // ...and the unknown-identity case is logged and skipped.
  assert.match(ps1Text, /elseif \(-not \$stalePath\) \{/, 'missing the unreadable-path branch');
  assert.match(ps1Text, /stale pid \$\{stalePid\}: identity unknown, not stopping\./);
});

test('bootstrap.ps1: Stop-Process is unreachable unless $isOurs is true', () => {
  const stops = ps1Text.match(/^[^\r\n]*Stop-Process[^\r\n]*$/gm) ?? [];
  assert.equal(stops.length, 1, `expected exactly one Stop-Process line, found ${stops.length}`);
  // Everything between "if ($isOurs) {" and its closing brace is the only
  // place that line may live.
  const guarded = ps1Text.match(/if \(\$isOurs\) \{([\s\S]*?)\n {6}\} elseif/);
  assert.ok(guarded, 'the Stop-Process branch is not the body of an "if ($isOurs)" gate');
  assert.ok(guarded[1].includes(stops[0].trim()), 'Stop-Process lives outside the $isOurs gate');
});

test('bootstrap.ps1 declares the bundled node paths exactly once (hoisted above the stale-pid stage)', () => {
  const nodeDirDecls = ps1Text.match(/^\$nodeDir = /gm) ?? [];
  const nodeExeDecls = ps1Text.match(/^\$nodeExe = /gm) ?? [];
  assert.equal(nodeDirDecls.length, 1);
  assert.equal(nodeExeDecls.length, 1);
  assert.ok(
    ps1Text.indexOf('$nodeExe = ') < ps1Text.indexOf('$stalePid'),
    'the bundled node.exe path must be known before the stale-pid identity check runs',
  );
});

// Fix round 1 finding #3: bootstrap.log must not grow forever.
test('bootstrap.ps1 writes a run separator and rotates the log past 512KB', () => {
  assert.match(ps1Text, /---- run /, 'missing a per-run separator line');
  assert.match(ps1Text, /524288/, 'missing the 512KB (524288 byte) rotation threshold');
  assert.match(ps1Text, /bootstrap\.log\.1/, 'missing the bootstrap.log.1 rotation target');
});

// 2.0.23 (2026-09-19 home-desktop): a leftover server of an OLDER package must
// not be reused -- every later zip kept opening the stale "2.0.19" screen.
test('bootstrap.ps1 reuses a running server only when it is the same version; otherwise asks it to quit (never kills by name)', () => {
  assert.match(ps1Text, /lockJson\.package\.version/, 'must read this package version from lock.json');
  assert.match(ps1Text, /probeBody\.version/, 'must read the running server version from /api/health');
  assert.match(ps1Text, /\/api\/quit"\s+-Method Post\s+-ContentType 'application\/json'\s+-Body '\{\}'/, 'the quit POST must carry a JSON body or the CSRF guard answers 415 (2.0.24)');
  assert.match(ps1Text, /\$Auto\.IsPresent -or/, '--auto must always run its own package');
  assert.doesNotMatch(ps1Text, /Stop-Process[^\n]*-Name/i);
});

// P18 (2026-11-18): school / office networks. The block between the two stage
// markers is run on its own in a real PowerShell with a stub Log, and the
// variables it leaves behind are what the server (and every node it starts)
// inherits.
function runNetBlock(env) {
  const start = ps1Text.indexOf('# --- School / office networks');
  const end = ps1Text.indexOf('# --- Stage: server + browser');
  assert.ok(start > 0 && end > start, 'network block must sit right before the server stage');
  const block = ps1Text.slice(start, end);
  const script = `function Log($m) { Write-Output "LOG:$m" }\n${block}\n` +
    "Write-Output \"CA=$env:NODE_USE_SYSTEM_CA\"; Write-Output \"P=$env:HTTPS_PROXY\"; Write-Output \"HP=$env:HTTP_PROXY\"; Write-Output \"NP=$env:NO_PROXY\"; Write-Output \"EP=$env:NODE_USE_ENV_PROXY\"";
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(https?|no)_proxy$/i.test(k) && !/^NODE_USE_/.test(k)));
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...clean, ...env }, encoding: 'utf8', timeout: 30000 });
  return Object.fromEntries(String(r.stdout).split(/\r?\n/).filter((l) => /^[A-Z]+[:=]/.test(l)).map((l) => { const i = l.search(/[:=]/); return [l.slice(0, i), l.slice(i + 1)]; }));
}

test('bootstrap.ps1 always trusts the Windows root store (school TLS inspection) and adds no proxy when none is set', { skip: process.platform !== 'win32' }, () => {
  const out = runNetBlock({});
  assert.equal(out.CA, '1');
  // this development PC has no Windows proxy; a school PC would get one here
  if (out.LOG === 'Network: no proxy.') {
    assert.equal(out.P, ''); assert.equal(out.EP, '');
  } else {
    assert.match(out.P, /^http:\/\/[^\s]+:\d+$/); assert.equal(out.EP, '1');
  }
});

test('bootstrap.ps1 keeps a given HTTPS_PROXY, turns on NODE_USE_ENV_PROXY and keeps this PC off the proxy', { skip: process.platform !== 'win32' }, () => {
  const out = runNetBlock({ HTTPS_PROXY: 'http://proxy.school.kr:8080', NO_PROXY: 'intra.school.kr' });
  assert.equal(out.P, 'http://proxy.school.kr:8080');
  assert.equal(out.HP, 'http://proxy.school.kr:8080');
  assert.equal(out.EP, '1');
  assert.deepEqual(out.NP.split(','), ['intra.school.kr', 'localhost', '127.0.0.1', '::1']);
  assert.equal(out.LOG, 'Network: using proxy http://proxy.school.kr:8080.');
});

// P18 (2026-11-18): Korean guidance + 60 s wait.
const KO_PATH = path.join(ROOT_DIR, 'installer', 'bootstrap-ko.json');

test('every bootstrap failure exits through Fail with a Korean reason that exists in bootstrap-ko.json', () => {
  const ko = JSON.parse(fs.readFileSync(KO_PATH, 'utf8'));
  assert.doesNotMatch(ps1Text, /^\s*exit 1[0-3]\s*$/m, 'no bare exit 10..13 left -- use Fail <code> <key>');
  const fails = [...ps1Text.matchAll(/^\s*Fail (1[0-3]) '([a-z0-9]+)'/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(fails.map((f) => f[0]).sort(), ['10', '11', '12', '13', '13']);
  const keys = new Set([...ps1Text.matchAll(/\bKo '([A-Za-z0-9]+)'/g)].map((m) => m[1]).concat(fails.map((f) => f[1])));
  for (const k of keys) assert.ok(typeof ko[k] === 'string' && /[가-힣]/.test(ko[k]), `bootstrap-ko.json needs a Korean "${k}"`);
  assert.match(ps1Text, /\$WaitSeconds = 60/);
  assert.match(ps1Text, /\$proc\.HasExited/, 'a server that dies on start must stop the wait early');
});

test('bootstrap.ps1 really prints the Korean reason and the log path, then exits 10 (zip not extracted)', { skip: process.platform !== 'win32' }, () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'iris-boot-ko-'));
  try {
    fs.mkdirSync(path.join(tmp, 'installer'));
    fs.copyFileSync(KO_PATH, path.join(tmp, 'installer', 'bootstrap-ko.json'));
    const cmd = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; & '${PS1_PATH.replace(/'/g, "''")}' -ZipRoot '${tmp.replace(/'/g, "''")}'; exit $LASTEXITCODE`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
      env: { ...process.env, LOCALAPPDATA: tmp }, encoding: 'utf8', timeout: 60000,
    });
    assert.equal(r.status, 10);
    assert.match(r.stdout, /압축을 먼저 풀어 주세요/);
    assert.match(r.stdout, /기록 파일을 보내 주세요: .*bootstrap\.log/);
    assert.match(r.stdout, /Please extract the zip file first/, 'the English log line stays');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a missing bootstrap-ko.json never blocks the install (English only, same exit code)', { skip: process.platform !== 'win32' }, () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'iris-boot-noko-'));
  try {
    const cmd = `& '${PS1_PATH.replace(/'/g, "''")}' -ZipRoot '${tmp.replace(/'/g, "''")}'; exit $LASTEXITCODE`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
      env: { ...process.env, LOCALAPPDATA: tmp }, encoding: 'utf8', timeout: 60000,
    });
    assert.equal(r.status, 10);
    assert.match(r.stdout, /Please extract the zip file first/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
