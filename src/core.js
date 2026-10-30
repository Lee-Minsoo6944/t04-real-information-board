// 브라우저와 Node(GitHub Actions)가 함께 쓰는 순수 로직. 외부 호출·저장소 접근 없음.
// 공개 계약(aleph-t04 public contract v2, fixture contract 1.1.0)의 정규화·저장·상태 전이를 따른다.
// live adapter(Open-Meteo)와 replay adapter(공개 fixture)가 모두 이 파일의 같은 함수로 저장한다.

export const TZ = 'Asia/Seoul';
export const SIGNAL_ID = 'daejeon-temperature-2m';

export const SOURCE = {
  name: 'Open-Meteo Forecast API',
  home: 'https://open-meteo.com/',
  url: 'https://api.open-meteo.com/v1/forecast?latitude=36.3504&longitude=127.3845&current=temperature_2m&timezone=Asia%2FSeoul',
  metric: '대전 현재 기온 (지상 2m)',
};

export const NORMALIZED_KEYS = Object.freeze([
  'signal_id', 'normalized_value', 'unit', 'source_name', 'source_url',
  'source_time', 'fetched_at', 'record_timezone', 'record_date',
]);

export const ERROR_CODES = Object.freeze(['timeout', 'auth', 'rate_limit', 'offline', 'schema_error']);

export const ERROR_TEXT = {
  timeout:      { title: '응답이 너무 느림 (timeout)', explain: '외부 원천이 제한 시간 안에 답하지 않았습니다. 원천 서버가 바쁘거나 네트워크가 느린 상태입니다.', action: '잠시 뒤 다시 시도하세요.' },
  auth:         { title: '외부 원천이 거절함 (401/403 · auth)', explain: '외부 데이터 원천이 요청을 거절했습니다. 이 정보판의 로그인 문제가 아니라, 원천의 이용 정책이 바뀌었거나 접근이 막힌 상태입니다.', action: '다시 시도해도 같을 수 있습니다. 원천의 공지·이용 조건을 확인해야 합니다.' },
  rate_limit:   { title: '호출 제한 (429 · rate_limit)', explain: '짧은 시간에 너무 많이 호출해 외부 원천이 잠시 막았습니다.', action: '안내된 대기 시간이 지난 뒤 다시 시도하세요.' },
  offline:      { title: '오프라인 (offline)', explain: '이 기기가 인터넷에 연결되어 있지 않아 외부 원천에 닿지 못했습니다.', action: '인터넷 연결을 확인한 뒤 다시 시도하세요.' },
  schema_error: { title: '응답 형식이 바뀜 (schema_error)', explain: '외부 원천이 답했지만 값·단위·시각 필드가 없거나 타입이 다릅니다. 잘못된 값을 저장하지 않으려고 버렸습니다.', action: '다시 시도해도 같다면 원천 형식 변경에 맞춰 코드를 고쳐야 합니다.' },
};

export class SourceError extends Error {
  constructor(code, detail) { super(`${code}: ${detail || ''}`); this.code = code; this.detail = detail || ''; }
}

const clone = (v) => JSON.parse(JSON.stringify(v));

// ── 날짜 ─────────────────────────────────────────
export function kstDate(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) throw new TypeError('날짜가 올바르지 않음');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function fmtKst(at) {
  if (!at) return '—';
  const d = new Date(at);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} KST`;
}

// ── 실패 분류 ────────────────────────────────────
export function classifyHttp(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 200 && status < 300) return null;
  return 'schema_error'; // 참조 adapter 와 같이: 그 밖의 응답은 기대 형식이 아님
}

export function classifyException(err, { online = true } = {}) {
  if (err instanceof SourceError) return err.code;
  if (err && err.name === 'AbortError') return 'timeout';
  if (!online) return 'offline';
  if (err && err.name === 'TypeError') return 'offline'; // fetch 네트워크 실패
  return 'schema_error';
}

// ── 정규화 ───────────────────────────────────────
// Open-Meteo 원 응답 → normalized reading (normalized-reading.schema.json 과 같은 모양)
export function normalizeOpenMeteo(raw, fetched_at, sourceUrl = SOURCE.url) {
  const bad = (why) => { throw new SourceError('schema_error', why); };
  if (!raw || typeof raw !== 'object') bad('응답이 객체가 아님');
  const cur = raw.current, units = raw.current_units;
  if (!cur || typeof cur !== 'object') bad('current 필드 없음');
  if (!units || typeof units !== 'object') bad('current_units 필드 없음');
  if (typeof cur.temperature_2m !== 'number' || !Number.isFinite(cur.temperature_2m)) bad('current.temperature_2m 이 숫자가 아님');
  if (typeof units.temperature_2m !== 'string' || !units.temperature_2m) bad('단위 없음');
  if (typeof cur.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(cur.time)) bad('current.time 형식이 다름');
  if (raw.utc_offset_seconds !== 32400 || raw.timezone !== TZ) bad('원천 시간대가 Asia/Seoul(+09:00)이 아님');
  return {
    signal_id: SIGNAL_ID,
    normalized_value: cur.temperature_2m,
    unit: units.temperature_2m,
    source_name: SOURCE.name,
    source_url: sourceUrl,
    source_time: `${cur.time}:00+09:00`,
    fetched_at,
    record_timezone: TZ,
    record_date: kstDate(fetched_at),
  };
}

// 저장 직전 공통 검사. 실패하면 schema_error.
export function validateReading(r) {
  const bad = (why) => { throw new SourceError('schema_error', why); };
  if (!r || typeof r !== 'object' || Array.isArray(r)) bad('정규화 값이 객체가 아님');
  const keys = Object.keys(r).sort(), want = [...NORMALIZED_KEYS].sort();
  if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) bad(`필드가 정확히 ${NORMALIZED_KEYS.join(', ')} 이어야 함`);
  if (typeof r.signal_id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(r.signal_id) || r.signal_id.length > 100) bad('signal_id 형식');
  if (typeof r.normalized_value !== 'number' || !Number.isFinite(r.normalized_value)) bad(`normalized_value 가 숫자가 아님 (${typeof r.normalized_value})`);
  for (const f of ['unit', 'source_name']) if (typeof r[f] !== 'string' || !r[f].trim()) bad(`${f} 없음`);
  let u; try { u = new URL(r.source_url); } catch { bad('source_url 이 절대 주소가 아님'); }
  if (u.protocol !== 'https:') bad('source_url 이 https 가 아님');
  if (r.source_time !== null && Number.isNaN(new Date(r.source_time).getTime())) bad('source_time 형식');
  if (Number.isNaN(new Date(r.fetched_at).getTime())) bad('fetched_at 형식');
  if (r.record_timezone !== TZ) bad('record_timezone 이 Asia/Seoul 이 아님');
  if (r.record_date !== kstDate(r.fetched_at)) bad('record_date 가 fetched_at 의 Asia/Seoul 날짜와 다름');
  return true;
}

// ── 저장·상태 전이 ───────────────────────────────
export function resetState() {
  return {
    daily_readings: [],
    current_reading: null,   // 마지막 정상값
    status: null,            // { freshness: fresh|stale, error_code }
    last_comparison: { state: 'insufficient', direction: null, magnitude: null, unit: null },
    last_delta: null,
    last_run: null,
    sequence: 0,
  };
}

// 소수 자릿수(지수 표기 제외)
const decimals = (n) => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };

// 변화 계산 규칙: 같은 signal 의 바로 앞 날짜 행과 비교. 크기 = |현재 − 이전|, 두 값 중 긴 소수 자릿수로 맞춰 부동소수점 오차만 제거.
export function comparisonFor(rows, cur) {
  const prev = rows.filter((r) => r.signal_id === cur.signal_id && r.record_date < cur.record_date)
    .sort((a, b) => b.record_date.localeCompare(a.record_date))[0];
  if (!prev) return { state: 'insufficient', direction: null, magnitude: null, unit: null };
  if (prev.unit !== cur.unit) return { state: 'unit_mismatch', direction: null, magnitude: null, unit: null };
  const d = Math.max(decimals(prev.normalized_value), decimals(cur.normalized_value));
  const signed = Number((cur.normalized_value - prev.normalized_value).toFixed(d));
  return {
    state: 'comparable',
    direction: signed > 0 ? 'increase' : signed < 0 ? 'decrease' : 'unchanged',
    magnitude: Math.abs(signed),
    unit: cur.unit,
    from: { record_date: prev.record_date, normalized_value: prev.normalized_value },
    to: { record_date: cur.record_date, normalized_value: cur.normalized_value },
  };
}

// 같은 signal_id + record_date 는 같은 행(record_id 유지)을 갱신, 다음 날짜는 새 행.
export function applySuccess(input, reading, meta = {}) {
  validateReading(reading);
  const s = clone(input);
  const i = s.daily_readings.findIndex((r) => r.signal_id === reading.signal_id && r.record_date === reading.record_date);
  const ex = i >= 0 ? s.daily_readings[i] : null;
  const row = {
    record_id: ex ? ex.record_id : `${reading.signal_id}-${reading.record_date}`,
    signal_id: reading.signal_id,
    record_date: reading.record_date,
    normalized_value: reading.normalized_value,
    unit: reading.unit,
    first_fetched_at: ex ? ex.first_fetched_at : reading.fetched_at,
    last_fetched_at: reading.fetched_at,
    success_count: (ex ? ex.success_count || 1 : 0) + 1,
    reading: clone(reading),
    ...(meta.raw_file ? { raw_file: meta.raw_file } : {}),
  };
  if (i >= 0) s.daily_readings[i] = row; else s.daily_readings.push(row);
  s.daily_readings.sort((a, b) => a.record_date.localeCompare(b.record_date));
  s.current_reading = clone(reading);
  s.status = { freshness: 'fresh', error_code: 'none' };
  s.last_comparison = comparisonFor(s.daily_readings, row);
  s.last_delta = s.last_comparison.magnitude;
  s.sequence += 1;
  s.last_run = { fixture_id: meta.fixture_id || null, at: meta.at || reading.fetched_at, outcome: 'success', error_code: 'none', detail: '', retry_after_seconds: null };
  return s;
}

// 실패: 마지막 정상값·일별 행은 그대로 두고 상태만 stale + error_code 로 바꾼다.
export function applyError(input, code, meta = {}) {
  if (!ERROR_CODES.includes(code)) throw new TypeError(`지원하지 않는 error_code: ${code}`);
  const s = clone(input);
  s.status = { freshness: 'stale', error_code: code };
  s.sequence += 1;
  s.last_run = { fixture_id: meta.fixture_id || null, at: meta.at || null, outcome: 'error', error_code: code, detail: meta.detail || '', retry_after_seconds: meta.retry_after_seconds ?? null };
  return s;
}

export function fmtComparison(c) {
  if (!c || c.state !== 'comparable') return null;
  const sign = c.direction === 'increase' ? '+' : c.direction === 'decrease' ? '−' : '±';
  const word = c.direction === 'increase' ? '상승' : c.direction === 'decrease' ? '하락' : '변화 없음';
  return { text: `${sign}${c.magnitude} ${c.unit}`, word };
}
