// 검사: 기록 꼬리 읽기가 한글 글자 중간에서 끊겨도 깨지지 않는지(P18, 2026-11-18 점검 — transcript.mjs poll).
// 임시 파일에 클로드 기록 줄을 바이트 단위로 쪼개 써 가며 poll 한다(실 CLI·데몬 접촉 0). npm run verify:utf8tail
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TranscriptTail } from '../daemon/transcript.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-face-utf8tail-'));
const file = path.join(dir, 'rec.jsonl');
const TEXT = '안녕하세요 — 수학 불안 표를 정리했어요. 결과: 한글·漢字·😀 모두 온전';
const line = (i) => JSON.stringify({ type: 'assistant', timestamp: `2026-11-18T00:00:0${i}Z`, message: { id: `m${i}`, role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: `${TEXT} ${i}` }] } }) + '\n';

// 두 줄을 이어 붙인 바이트를 일부러 여러 바이트 글자 한가운데서 자르며 조금씩 쓴다
const bytes = Buffer.from(line(1) + line(2), 'utf8');
const cuts = [];
for (let i = 0; i < bytes.length; i++) if ((bytes[i] & 0xc0) === 0x80 && cuts.length < 12 && i % 7 === 0) cuts.push(i); // 이어지는 바이트(글자 한가운데) 자리
ok(cuts.length >= 5, `글자 한가운데 자르는 자리 ${cuts.length}곳`);
fs.writeFileSync(file, '');
const tail = new TranscriptTail(file, 'claude');
const got = [];
let prev = 0;
for (const c of [...cuts, bytes.length]) {
  fs.appendFileSync(file, bytes.subarray(prev, c)); prev = c;
  got.push(...tail.poll());
}
const texts = got.filter((it) => it.kind === 'assistant' || it.text).map((it) => it.text);
ok(texts.length === 2, `두 줄이 정확히 두 항목으로 (${texts.length})`);
ok(texts.every((t) => !t.includes('�')), '깨진 글자(�) 없음');
ok(texts[0] === `${TEXT} 1` && texts[1] === `${TEXT} 2`, '글자가 원문과 똑같음(한글·한자·그림 문자)');
ok(Buffer.isBuffer(tail.partial) && tail.partial.length === 0, '남은 반쪽 줄 없음');

// 파일이 줄어들면(다시 써짐) 처음부터 — 반쪽 줄도 비운다
fs.writeFileSync(file, line(3).slice(0, 20));
tail.poll();
fs.writeFileSync(file, line(4));
const after = tail.poll();
ok(after.length === 1 && after[0].text === `${TEXT} 4` && tail.reset === true, '파일이 줄면 반쪽 줄을 버리고 새로 읽음');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
