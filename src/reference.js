// 참고 지표 (환율·코스피). 일별 기록·채점 대상이 아니며 화면에만 보여 준다.
// 정규화·형식 검사는 브라우저와 기록 봇이 함께 쓴다.
import { SourceError } from './core.js';

export const FX = {
  name: 'Frankfurter (유럽중앙은행 기준환율)',
  url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW',
  metric: '원/달러 환율 (USD → KRW)',
  unit: 'KRW/USD',
};

export const KOSPI = {
  name: 'Yahoo Finance (비공식 공개 시세)',
  url: 'https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11?range=1d&interval=1d',
  metric: '코스피 지수 (KOSPI Composite)',
  unit: 'pt',
};

const bad = (why) => { throw new SourceError('schema_error', why); };
const num = (v, f) => (typeof v === 'number' && Number.isFinite(v) ? v : bad(`${f} 이 숫자가 아님`));

export function normalizeFx(raw, fetched_at) {
  if (!raw || typeof raw !== 'object') bad('응답이 객체가 아님');
  if (raw.base !== 'USD') bad('base 가 USD 가 아님');
  if (typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) bad('date 형식이 다름');
  return {
    value: num(raw.rates?.KRW, 'rates.KRW'),
    unit: FX.unit,
    source_name: FX.name,
    source_url: FX.url,
    source_time: raw.date,           // 유럽중앙은행 기준일 (영업일, 하루 한 번)
    fetched_at,
  };
}

export function normalizeKospi(raw, fetched_at) {
  const m = raw?.chart?.result?.[0]?.meta;
  if (!m) bad('chart.result[0].meta 없음');
  if (m.symbol !== '^KS11') bad('symbol 이 ^KS11 이 아님');
  const t = num(m.regularMarketTime, 'regularMarketTime');
  const value = num(m.regularMarketPrice, 'regularMarketPrice');
  const prev = num(m.chartPreviousClose, 'chartPreviousClose');
  return {
    value,
    unit: KOSPI.unit,
    prev_close: prev,
    change: Number((value - prev).toFixed(2)),
    source_name: KOSPI.name,
    source_url: KOSPI.url,
    source_time: new Date(t * 1000).toISOString(),
    fetched_at,
  };
}
