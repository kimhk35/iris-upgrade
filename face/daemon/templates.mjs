// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// templates.mjs — 자주 쓰는 요청 서식함(P18 2026-11-24 2차 시안 3번). state\templates.json 한 파일, 이 PC 에만. 빈칸 = {이름}.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = [
  { name: '가정통신문', text: '「{행사}」 안내 가정통신문을 A4 1쪽 한글 파일로 만들어 줘. 날짜는 {날짜}, 회신은 {회신}까지.' },
  { name: '문항 만들기', text: '{단원} 단원에서 {난이도} 난이도 문항 {개수}개를 만들고 정답과 풀이를 붙여 줘.' },
  { name: '수업 슬라이드', text: '{학년} {단원} 수업 슬라이드를 {쪽수}쪽 안팎의 PPT 로 만들어 줘. 도입 질문과 활동 1개를 넣어 줘.' },
  { name: '활동지', text: '{단원} 활동지를 A4 {쪽수}쪽 한글 파일로 만들어 줘. 쓰는 칸을 넉넉히 두고 정답지도 따로 만들어 줘.' },
  { name: '채점 기준표', text: '{과제} 수행평가 채점 기준표를 {요소수}개 평가 요소, 3단계 척도의 표로 만들어 줘.' },
  { name: '회의록 정리', text: '아래 회의 내용을 {형식}으로 정리하고 할 일·담당·기한을 표로 만들어 줘.' },
  { name: '글 다듬기', text: '아래 글을 {읽는 사람}에게 맞게 자연스러운 우리말로 다듬어 줘. 뜻은 바꾸지 말고 바꾼 곳을 짧게 알려 줘.' },
  { name: '자료 요약', text: '첨부한 자료를 {분량}으로 요약하고, 핵심 근거는 몇 쪽인지 함께 적어 줘.' },
];
const clean = (list) => (Array.isArray(list) ? list : []).map((x) => ({ name: String(x?.name || '').trim().slice(0, 40), text: String(x?.text || '').replace(/\r\n/g, '\n').slice(0, 4000) })).filter((x) => x.name && x.text.trim()).slice(0, 100);

export class Templates {
  constructor(file) { this.file = file; }
  /** 저장한 적이 없으면 기본 서식. 사용자가 모두 지웠으면 빈 목록을 존중. */
  get() { try { return clean(JSON.parse(fs.readFileSync(this.file, 'utf8')).list); } catch { return DEFAULTS.map((x) => ({ ...x })); } }
  set(list) {
    const v = clean(list); fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const t = `${this.file}.tmp`; fs.writeFileSync(t, JSON.stringify({ list: v }, null, 2), 'utf8'); fs.renameSync(t, this.file); return v;
  }
}
