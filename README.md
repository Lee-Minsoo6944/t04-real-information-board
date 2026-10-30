# 대전 기온 정보판 (과제 4 · 오늘의 진짜 정보판)

대전 현재 기온을 매일 한 번 기록하고 직전 날짜 기록과 비교합니다. 데이터가 오지 않으면 실패 종류·다음 행동·마지막 정상값을 함께 보여 줍니다.

- **값**: 대전광역시청 부근(36.3504, 127.3845) 현재 기온 (지상 2m), 단위 °C, `signal_id = daejeon-temperature-2m`
- **출처**: [Open-Meteo Forecast API](https://open-meteo.com/) — 비밀키·로그인 없는 공개 API, 비개인 데이터
  `https://api.open-meteo.com/v1/forecast?latitude=36.3504&longitude=127.3845&current=temperature_2m&timezone=Asia%2FSeoul`
- **출처 시각** (`source_time`): 응답의 `current.time` (원천 관측 시각, 15분 단위, +09:00)
- **조회 시각** (`fetched_at`): 이 값을 받아 온 시각 (UTC 로 저장, KST 로 표시)
- **기준 시간대**: Asia/Seoul

## 공개 fixture 꾸러미

`assets/t04-real-information-board-public-v1/` 에 공개 꾸러미(`aleph-t04-real-information-board-public-contract-v2`, contract 2.0.0, fixture contract 1.1.0)를 바이트 그대로 넣었습니다. 화면 ④에서 17개 파일의 SHA-256 을 브라우저가 직접 계산해 `asset-manifest.json` 과 대조합니다.

## 구조

| 파일 | 하는 일 |
|---|---|
| `index.html`, `src/app.js` | 공개 심사 화면 (정적, 빌드 없음) |
| `src/core.js` | 정규화(normalized reading)·형식 검사·실패 분류·KST 날짜·일별 저장·변화 계산 (브라우저와 Node 공용) |
| `src/adapter.js` | live adapter(Open-Meteo)와 replay adapter(공개 fixture)가 같은 시도→저장 경로를 탄다 |
| `src/package.js` | 공개 꾸러미 읽기 + SHA-256 대조 |
| `src/selftest.js` | 공개 재생 순서와 fixture `expected` 대조 |
| `scripts/record-daily.mjs` | 실제 원천 조회 → `data/daily.json`, `data/raw/<날짜>.json` |
| `.github/workflows/daily.yml` | 매일 09:00 KST 에 위 스크립트 실행 후 커밋 (수동 실행 가능) |

## 규칙

- **일별 고유키**: `signal_id + record_date`, `record_date` = `fetched_at` 의 Asia/Seoul 날짜. 같은 키의 재성공은 같은 `record_id` 행을 갱신(`success_count` 증가), 다음 날짜는 새 행.
- **상태**: `fresh / none` 또는 `stale / {timeout, auth, rate_limit, offline, schema_error}`. 실패해도 `current_reading`(마지막 정상값)과 일별 행은 그대로.
- **변화**: 같은 signal 의 바로 앞 날짜 행과 비교. 방향(증가/감소/변화 없음)과 크기 `|현재 − 이전|`. 두 값 중 긴 소수 자릿수로 맞춰 부동소수점 오차만 없앤다. 단위가 다르면 비교하지 않는다.
- 합성 fixture 날짜(2026-08-24/25)는 실제 날짜 기록을 대신하지 않는다.

## 실제 기록

첫 실제 기록부터 GitHub Actions(`daily-record`)가 남깁니다. 기록 목록은 [data/daily.json](data/daily.json), 원 응답은 `data/raw/<날짜>.json` 에 있습니다. 기록을 손으로 꾸며 넣지 않습니다.

> 처음에는 서울 기온으로 시작했다가 2026-10-30 에 대전 기온으로 바꿨습니다. 서울 기록 1건(13.5 °C)은 다른 지점 값이라 비교에서 빼고 Git 기록에만 남겼습니다.

## 비밀값

이 저장소는 비밀키를 쓰지 않습니다. 확인:

```bash
git grep -n -i -E "api[_-]?key|secret|token|password|bearer|authorization" $(git rev-list --all)
```

데이터: Weather data by Open-Meteo.com (CC BY 4.0)
