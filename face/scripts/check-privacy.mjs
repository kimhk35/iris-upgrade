// 보내기 전 개인정보 확인(app/privacy.js) · 지난 대화 검색(daemon/search.mjs) 규칙 검사 — 네트워크·실 데몬 접촉 0.   npm run verify:privacy
// 아래 번호·이름은 모두 지어낸 것이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { searchSessions, snippet, wordsOf } from '../daemon/search.mjs';
new Function(fs.readFileSync(new URL('../app/privacy.js', import.meta.url), 'utf8'))();
const { scan, mask } = globalThis.__irisPrivacy;
let pass = 0; const t = (n, f) => { f(); pass++; console.log('PASS', n); };
const types = (s) => scan(s).map((x) => x.type).join(',');

t('휴대전화(붙임표·빈칸·붙여 쓰기)', () => { for (const s of ['010-1234-5678', '010 1234 5678', '01012345678', '연락처:010.1234.5678.']) assert.equal(types(s), 'phone', s); });
t('유선전화', () => { assert.equal(types('학교 02-123-4567 로'), 'tel'); assert.equal(types('031-123-4567'), 'tel'); });
t('주민번호 · 외국인번호(있을 수 있는 날짜만)', () => { assert.equal(types('120304-3123456'), 'rrn'); assert.equal(types('1203045123456'), 'rrn'); assert.equal(types('129999-3123456'), ''); });
t('학번과 이름', () => { for (const s of ['10203 김민수', '30115 이서연 학생은', '10203김민수가', '10203\t박지우\n10204\t최하늘']) assert.match(types(s), /student/, s); assert.equal(scan('10203\t박지우\n10204\t최하늘').length, 2); });
t('학년·반·번호', () => { assert.equal(types('1학년 2반 3번 김민수'), 'student'); assert.equal(types('2학년 3반 이서연 학생'), 'student'); });
t('이메일', () => { assert.equal(types('abc.def@example.com 으로'), 'email'); assert.equal(types('git@github.com:a/b.git'), ''); });
t('흔한 글은 걸리지 않음', () => {
  for (const s of ['10203 이차함수의 그래프', '20000 원을 냈다', '2025 김연아', '1학년 2반 수업', '2학년 3반 학생 명단을 만들어 줘', '3.14159 와 12345', '문제 10101 장난감', '10203 정답은 3번', '30115 성적 처리', '버전 2.1.3-20261124', '2026-11-24 10:30', 'ISBN 9788912345678', '1학기 2회 고사', '점수 90점 이상', '010 이진수', 'https://iris.mathmckay.kr/#install', '전화번호를 적는 칸'])
    assert.equal(types(s), '', `${s} → ${types(s)}`);
});
t('가리기: 같은 학생은 같은 이름표, 다른 자리의 이름도', () => {
  const m = mask('10203 김민수, 10204 이서연 상담. 김민수는 010-1234-5678, 이서연이 말함. 김민수학교 이야기');
  assert.equal(m, '[학생1], [학생2] 상담. [학생1]는 010-****-****, [학생2]이 말함. 김민수학교 이야기');
});
t('가리기: 주민번호 · 이메일', () => { assert.equal(mask('120304-3123456 / a.b@example.com'), '******-******* / ***@***'); });
t('파일 경로 속은 알리되 바꾸지 않음', () => {
  const s = 'C:\\상담\\10203 김민수.hwp 를 읽고 10203 김민수 이야기를 정리해 줘';
  const f = scan(s); assert.equal(f.length, 2); assert.equal(f[0].inPath, true);
  assert.equal(mask(s), 'C:\\상담\\10203 김민수.hwp 를 읽고 [학생1] 이야기를 정리해 줘');
});
t('긴 글도 빠름', () => { const s = '가나다 12345 abc@ '.repeat(8000); const a = Date.now(); scan(s); mask(s); assert.ok(Date.now() - a < 1500, `${Date.now() - a}ms`); });

// ── 검색 ──
const S = [
  { rec: { id: 'a', agent: 'claude', title: '채점 기준', cwd: 'C:\\일\\수업' }, items: [{ i: 1, t: '2026-11-01T00:00:00Z', kind: 'user', text: '2학기 수행평가 채점 기준표' }, { i: 2, kind: 'tool_result', text: '수행평가 도구 출력' }, { i: 3, t: '2026-11-02T00:00:00Z', kind: 'assistant', text: '수행평가 기준은 다음과 같습니다' }] },
  { rec: { id: 'b', agent: 'codex', title: '수행평가 안내문', cwd: 'C:\\일\\안내' }, items: [{ i: 1, t: '2026-11-20T00:00:00Z', kind: 'user', text: 'Hello World' }] },
];
t('검색: 요청·답에서만, 최근 것부터, 제목도', () => { const r = searchSessions(S, '수행평가'); assert.deepEqual(r.sessions.map((x) => [x.id, x.hits.map((h) => h.i)]), [['a', [3, 1]], ['b', []]]); });
t('검색: 여러 낱말은 모두 · 대소문자 없음 · AI 고르기', () => { assert.deepEqual(searchSessions(S, '채점 2학기').sessions.map((x) => x.id), ['a']); assert.equal(searchSessions(S, 'hello').total, 1); assert.equal(searchSessions(S, '수행평가', { agent: 'codex' }).total, 1); });
t('검색: 빈 말·한 글자는 찾지 않음, 풀어 쓴 한글도 맞춤', () => { assert.equal(searchSessions(S, ' 가 ').total, 0); assert.equal(searchSessions(S, '수행평가'.normalize('NFD')).total, 2); assert.deepEqual(wordsOf('  A  a b '), ['a', 'b']); });
t('검색: 낱말 둘레만 잘라 보임', () => { const s = snippet('가'.repeat(300) + ' 수행평가 ' + '나'.repeat(300), ['수행평가']); assert.ok(s.startsWith('…') && s.endsWith('…') && s.includes('수행평가') && s.length < 140); });
console.log(`check-privacy: ${pass} PASS`);
