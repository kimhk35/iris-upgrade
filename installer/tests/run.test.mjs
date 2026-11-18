import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, batchLine, quoteArg, isBatch, killTree } from '../lib/run.mjs';

const WIN = process.platform === 'win32';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-run-'));

/** 인자를 그대로 되돌려 주는 배치 픽스처. 지연 확장이라 값 안의 `&`·`^` 가 배치 안에서 재해석되지 않는다. */
function echoFixture(name) {
  const p = path.join(scratch, name);
  fs.writeFileSync(p, [
    '@echo off',
    'setlocal enabledelayedexpansion',
    ':loop',
    'if "%~1"=="" goto end',
    'set "A=%~1"',
    'echo([!A!]',
    'shift',
    'goto loop',
    ':end',
    '',
  ].join('\r\n'), 'ascii');
  return p;
}

function fixture(name, body) {
  const p = path.join(scratch, name);
  fs.writeFileSync(p, body, 'ascii');
  return p;
}

const echoed = (r) => r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/^\[|\]$/g, ''));

test('isBatch recognises .cmd/.bat regardless of case, and nothing else', () => {
  assert.equal(isBatch('C:\\x\\claude.cmd'), true);
  assert.equal(isBatch('C:\\x\\claude.CMD'), true);
  assert.equal(isBatch('C:\\x\\go.Bat'), true);
  assert.equal(isBatch('C:\\x\\node.exe'), false);
  assert.equal(isBatch('python'), false);
  assert.equal(isBatch('C:\\cmd.bat.exe'), false);
});

test('batchLine wraps the whole line once more so cmd /s strips only the outer pair', () => {
  const line = batchLine('C:\\Program Files\\t\\a.cmd', ['plain', 'two words']);
  assert.equal(line, '""C:\\Program Files\\t\\a.cmd" "plain" "two words""');
  const stripped = line.slice(1, -1);                     // cmd /s 가 벗기는 바깥 한 쌍
  assert.equal(stripped, '"C:\\Program Files\\t\\a.cmd" "plain" "two words"');
  assert.equal((stripped.match(/"/g) ?? []).length % 2, 0, '따옴표 상태가 균형이어야 한다');
  assert.equal(batchLine('a.cmd', []), '""a.cmd""');
});

test('quoteArg wraps the value untouched — batch %~1 strips only the outer pair', () => {
  assert.equal(quoteArg('two words'), '"two words"');
  assert.equal(quoteArg('say "hi"'), '"say "hi""');
  assert.equal(quoteArg('C:\\trailing\\'), '"C:\\trailing\\"');
  assert.equal(quoteArg(''), '""');
});

test('quoteArg refuses an odd number of quotes (cmd quote state would leak into redirection)', () => {
  assert.throws(() => quoteArg('odd"'), /홀수/);
  assert.throws(() => batchLine('a.cmd', ['ok', 'odd"']), /홀수/);
});

test('run() rejects such an argument without throwing or spawning anything', async () => {
  const r = await run('a.cmd', ['odd"'], { timeoutMs: 5000 });
  assert.equal(r.code, -1);
  assert.match(r.err, /홀수/);
  assert.equal(r.out, '');
});

test('run() executes a .cmd and passes arguments with spaces and quotes through', { skip: !WIN }, async () => {
  const exe = echoFixture('echo args.cmd');
  const args = ['plain', 'two words', 'say "hi"', 'a&b', 'a^b', 'C:\\path with space\\x', '--flag=v with space'];
  const r = await run(exe, args, { timeoutMs: 30000 });
  assert.equal(r.code, 0, `stderr=${r.err}`);
  assert.deepEqual(echoed(r), args);
});

test('run() reports a .cmd exit code and stderr unchanged', { skip: !WIN }, async () => {
  const exe = fixture('fail.cmd', '@echo off\r\necho boom 1>&2\r\nexit /b 7\r\n');
  const r = await run(exe, [], { timeoutMs: 30000 });
  assert.equal(r.code, 7);
  assert.equal(r.err, 'boom');
  assert.equal(r.out, '');
});

test('run() honours cwd and env for a .cmd', { skip: !WIN }, async () => {
  const exe = fixture('where.cmd', '@echo off\r\ncd\r\necho %IRIS_T18B%\r\n');
  const sub = path.join(scratch, 'sub dir');
  fs.mkdirSync(sub, { recursive: true });
  const r = await run(exe, [], { cwd: sub, env: { ...process.env, IRIS_T18B: 'ok' }, timeoutMs: 30000 });
  assert.equal(r.code, 0, `stderr=${r.err}`);
  assert.match(r.out, /sub dir/);
  assert.match(r.out, /\bok\b/);
});

test('run() feeds stdin to a .cmd when asked', { skip: !WIN }, async () => {
  const exe = fixture('read.cmd', '@echo off\r\nset /p L=\r\necho got:%L%\r\n');
  const r = await run(exe, [], { stdin: 'ignore', timeoutMs: 30000 });
  assert.equal(r.code, 0, `stderr=${r.err}`);   // stdin 옵션이 그대로 전달돼 멈추지 않는다
});

test('run() still spawns a non-batch executable directly (path unchanged)', async () => {
  const r = await run(process.execPath, ['-e', 'process.stdout.write("direct:" + process.argv[1])', 'two words'], { timeoutMs: 30000 });
  assert.equal(r.code, 0, `stderr=${r.err}`);
  assert.equal(r.out, 'direct:two words');
});

test('run() timeout kills only the process it spawned (parent survives)', async () => {
  const before = process.pid;
  const started = Date.now();
  const r = await run(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 700 });
  assert.ok(Date.now() - started < 20000, 'timeout must fire');
  assert.notEqual(r.code, 0);
  assert.equal(process.pid, before);
});

test('run() timeout kills a hung .cmd (the cmd.exe it spawned, by PID)', { skip: !WIN }, async () => {
  const exe = fixture('hang.cmd', '@echo off\r\n:loop\r\ngoto loop\r\n');   // cmd.exe 자기 안에서 도는 고리 — 손자 프로세스 없음
  const started = Date.now();
  const r = await run(exe, [], { timeoutMs: 800 });
  assert.ok(Date.now() - started < 20000, `timeout must fire (${Date.now() - started}ms)`);
  assert.notEqual(r.code, 0);
});

// P18 (2026-11-18): .cmd 시간 초과 때 cmd.exe 만 끄면 그 아래 node(npm 등)가 남아 파일을 붙잡았다.
// 손자 node 가 자기 PID 를 적고 오래 잠드는 .cmd 를 돌려, 시간 초과 뒤 그 손자가 사라졌는지 본다.
test('run() timeout also ends what the .cmd started (its process tree by PID), and still returns', { skip: !WIN }, async () => {
  const pidFile = path.join(scratch, 'grandchild.pid');
  const js = path.join(scratch, 'sleep.js');
  fs.writeFileSync(js, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 120000);`);
  // 경로는 환경 변수로 — 배치 파일 본문은 ASCII 라 한글 임시 경로를 직접 적으면 깨진다
  const exe = fixture('tree.cmd', '@echo off\r\n"%IRIS_T_NODE%" "%IRIS_T_JS%"\r\n');
  const started = Date.now();
  const r = await run(exe, [], { timeoutMs: 2500, env: { ...process.env, IRIS_T_NODE: process.execPath, IRIS_T_JS: js } });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - started < 20000, `must return (${Date.now() - started}ms)`);
  const gpid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(gpid > 0, 'the grandchild node really started');
  let alive = true;
  for (let i = 0; i < 30 && alive; i++) {
    try { process.kill(gpid, 0); await new Promise((res) => setTimeout(res, 200)); } catch { alive = false; }
  }
  if (alive) { try { process.kill(gpid); } catch { /* 정리 */ } }
  assert.equal(alive, false, 'the node started by the .cmd must be gone too');
});

test('killTree ignores a bad PID and asks taskkill for one tree by number (never by name)', () => {
  const calls = [];
  const spawnFn = (cmd, args) => { calls.push([cmd, ...args]); return { status: 0 }; };
  killTree(undefined, { platform: 'win32', spawnFn });
  killTree(0, { platform: 'win32', spawnFn });
  killTree(4321, { platform: 'win32', spawnFn });
  assert.deepEqual(calls, [['taskkill.exe', '/PID', '4321', '/T', '/F']]);
  assert.ok(!calls.flat().some((a) => /^\/IM$/i.test(a)), 'no /IM (image name)');
});

test.after(() => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* 스크래치 정리 실패는 무시 */ } });
