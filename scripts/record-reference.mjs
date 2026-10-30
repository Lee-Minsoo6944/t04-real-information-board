// 참고 지표: 코스피를 받아 data/reference.json 에 남긴다 (일별 기록·채점 대상 아님).
// 코스피 원천은 브라우저에서 직접 부를 수 없어(CORS) 기록 봇이 대신 받아 둔다. 비밀키 없음.
// 실패하면 마지막 정상값은 그대로 두고 실패 내용만 적는다.
import { readFile, writeFile } from 'node:fs/promises';
import { classifyHttp, classifyException, SourceError } from '../src/core.js';
import { KOSPI, normalizeKospi } from '../src/reference.js';

const FILE = new URL('../data/reference.json', import.meta.url);
let db = { kospi: { last_good: null, last_attempt: null } };
try { db = JSON.parse(await readFile(FILE, 'utf8')); } catch { /* 처음 실행 */ }

const at = new Date().toISOString();
try {
  const res = await fetch(KOSPI.url, { headers: { 'user-agent': 'Mozilla/5.0 (t04-board reference)' }, signal: AbortSignal.timeout(15000) });
  const code = classifyHttp(res.status);
  if (code) throw new SourceError(code, `HTTP ${res.status}`);
  const reading = normalizeKospi(await res.json(), at);
  db.kospi.last_good = reading;
  db.kospi.last_attempt = { at, outcome: 'success', error_code: 'none', detail: '' };
  console.log(`코스피 ${reading.value} (전일 종가 ${reading.prev_close}, 시세 시각 ${reading.source_time})`);
} catch (err) {
  db.kospi.last_attempt = { at, outcome: 'error', error_code: classifyException(err), detail: err.detail || err.message };
  console.error(`코스피 조회 실패 [${db.kospi.last_attempt.error_code}] ${err.message} — 마지막 정상값 유지`);
}
await writeFile(FILE, JSON.stringify(db, null, 2) + '\n');
