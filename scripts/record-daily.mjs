// 실제 공개 원천을 한 번 조회해 data/daily.json 에 기록한다. (GitHub Actions 에서 실행, Node 20+)
// 화면과 같은 core.js 의 정규화·검사·저장 함수를 쓴다. 비밀키 없음.
// 실패하면 기존 기록을 건드리지 않고 종료 코드 1.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { SOURCE, normalizeOpenMeteo, applySuccess, resetState, classifyHttp, classifyException, SourceError } from '../src/core.js';

const DAILY = new URL('../data/daily.json', import.meta.url);
const RAW_DIR = new URL('../data/raw/', import.meta.url);

const db = JSON.parse(await readFile(DAILY, 'utf8'));
const fetched_at = new Date().toISOString();

try {
  const res = await fetch(SOURCE.url, { signal: AbortSignal.timeout(15000) });
  const code = classifyHttp(res.status);
  if (code) throw new SourceError(code, `HTTP ${res.status}`);
  const raw = await res.json();
  const reading = normalizeOpenMeteo(raw, fetched_at);
  const raw_file = `data/raw/${reading.record_date}.json`;
  const before = db.daily_readings.length;
  const next = applySuccess({ ...resetState(), daily_readings: db.daily_readings }, reading, { raw_file });

  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(new URL(`${reading.record_date}.json`, RAW_DIR), JSON.stringify({ fetched_at, request_url: SOURCE.url, response: raw }, null, 2) + '\n');
  db.daily_readings = next.daily_readings;
  await writeFile(DAILY, JSON.stringify(db, null, 2) + '\n');
  console.log(`${next.daily_readings.length > before ? '새 행' : '같은 날 갱신'} ${reading.record_date}: ${reading.normalized_value} ${reading.unit} (원천 시각 ${reading.source_time}) · 총 ${next.daily_readings.length}행`);
} catch (err) {
  console.error(`조회 실패 [${classifyException(err)}] ${err.message} — 기존 기록 유지`);
  process.exit(1);
}
