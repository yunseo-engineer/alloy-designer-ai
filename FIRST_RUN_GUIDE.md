# 🚀 첫 실행 가이드 — 1~2편 PDF 테스트

> **예상 시간**: 2~3편 기준 약 3~5분 + API 호출 시간(논문당 1~2분)

## 📋 시뮬레이션: 2편 PDF 실행 흐름

### 준비 단계

```
papers/inbox/
├── wang2023.pdf          ← 들어올 때 여기
└── senkov_2018.pdf
```

### 명령 실행

```bash
python scripts/extract_paper.py --batch
```

---

## 단계별 진행 과정

### 📌 Step 1: 파일 감지 (1초)

```
[*] 일괄 처리 시작: 2개 파일
    - wang2023.pdf
    - senkov_2018.pdf
```

---

### 📌 Step 2: 첫 번째 파일 처리 (P001)

#### 2-1) 파일 인식

```
=== wang2023.pdf (.pdf) → P001 ===
```

- 파일명 상관없이 `P001`, `P002`, ... 자동 번호 부여
- `.pdf` 형식 인식 → Claude 멀티모달 추출 경로로

#### 2-2) API 호출 (⏱️ 1~2분)

```
[INFO] PDF 추출 시도 1/2
[INFO] [P001] LLM 호출 중...
```

- Claude API에 PDF 바이너리 + 프롬프트 전송
- 논문 전체에서 다음 정보 추출 시도:
  - **조성**: Ti-Zr-Hf-Nb-V 같은 조성 및 원자분율
  - **공정**: 용해, 압연, 어닐링 조건
  - **물성**: YS, 연신율, BCC 분율 등
  - **메타**: 저자, 저널, DOI

#### 2-3) 결과 저장

```
✅ P001 저장 완료: data/extracted/P001.json
   파일 이동: papers/processed/P001_wang2023.pdf
```

- `P001.json` 생성 (약 5~50KB)
  ```json
  {
    "paper": {
      "paper_id": "P001",
      "source_ref": "Wang et al., Acta Mater. 2023",
      "doi": "...",
      "extraction_confidence": "HIGH"
    },
    "alloys": [
      {
        "composition_raw": "TiZrHfNbV",
        "Ti_at": 20, "Zr_at": 20, "Hf_at": 20, "Nb_at": 20, "V_at": 20,
        ...
        "samples": [
          {
            "anneal_temp_C": 1000,
            "measurements": [
              {
                "test_mode": "tensile",
                "YS_MPa": 953,
                "elongation_pct": 42,
                ...
              }
            ]
          }
        ]
      }
    ]
  }
  ```

- 원본 PDF는 자동으로 `papers/processed/` 로 이동 (중복 처리 방지)

---

### 📌 Step 3: 두 번째 파일 처리 (P002)

위와 동일한 과정이 반복됩니다.

```
=== senkov_2018.pdf (.pdf) → P002 ===
[INFO] PDF 추출 시도 1/2
✅ P002 저장 완료: data/extracted/P002.json
   파일 이동: papers/processed/P002_senkov_2018.pdf
```

---

### 📌 최종 결과 (완료 메시지)

```
=== 완료: 성공 2, 실패 0 ===
```

이 시점에 실행이 끝납니다.

---

## 🔍 결과 확인

### 1️⃣ 생성된 JSON 파일

```
data/extracted/
├── P001.json          ← wang2023.pdf의 추출 결과
└── P002.json          ← senkov_2018.pdf의 추출 결과
```

### 2️⃣ 로그 기록

```
logs/extraction.log
```

```
2026-04-26 10:00:01 [INFO] 일괄 처리: 2개 파일
2026-04-26 10:00:02 [INFO] === wang2023.pdf (.pdf) → P001 ===
2026-04-26 10:00:05 [INFO] [P001] PDF 추출 시도 1/2
2026-04-26 10:01:23 [INFO] ✅ P001: data/extracted/P001.json
2026-04-26 10:01:24 [INFO] 파일 이동: papers/processed/P001_wang2023.pdf
2026-04-26 10:01:25 [INFO] === senkov_2018.pdf (.pdf) → P002 ===
...
2026-04-26 10:03:40 [INFO] === 완료: 성공 2, 실패 0 ===
```

### 3️⃣ 폴더 상태

**Before:**
```
papers/inbox/
├── wang2023.pdf
└── senkov_2018.pdf
papers/processed/
(비어있음)
```

**After:**
```
papers/inbox/
(비어있음 — 모두 processed로 이동)
papers/processed/
├── P001_wang2023.pdf
└── P002_senkov_2018.pdf
```

---

## ⚠️ 주의사항

### JSON 추출 실패했을 때

로그를 보면 다음 같은 메시지가 나올 수 있어:

```
[WARNING] [P001] JSON 파싱 실패: ... . 재시도.
[WARNING] [P001] LLM 오류: ... . 재시도.
```

→ 자동으로 최대 2회 재시도합니다. 그래도 실패하면:

```
❌ 실패 wang2023.pdf: [P001] PDF 추출 실패: ...
```

이 경우:
1. `papers/processed/`에서 원본 PDF를 다시 `papers/inbox/`로 옮기고
2. 프롬프트 개선 후 재시도하거나
3. 파일을 수동으로 검수

---

## 🎯 다음 단계

**batch 실행이 끝나면** 다음을 하세요:

### 선택지 1: 추출 품질 즉시 검토 (권장)

```bash
# P001.json 열어보기
cat data/extracted/P001.json | jq .

# 점검 사항:
# - composition_sum_at이 99.8 ~ 100.2 범위?
# - YS_MPa, elongation_pct이 채워졌나?
# - extraction_confidence가 HIGH/MED/LOW 중 하나?
```

만족스러우면 다음 단계로 넘어가도 되고, 개선 필요하면 `extract_paper.py`의 프롬프트를 수정.

### 선택지 2: 모든 단계를 한 번에

```bash
python scripts/validate.py
python scripts/descriptor_calc.py
python scripts/build_dataset.py
```

또는

```bash
python scripts/run_pipeline.py
```

이렇게 하면:

- ✅ **P001.json, P002.json** 검증 → `data/validated/` 복사
- ✅ **VEC, δ, ΔHmix 등** descriptor 자동 계산 (validated 파일 갱신)
- ✅ **master_dataset.json** (통합 DB) + **master_dataset.csv** (학습용 평탄화 테이블) 생성
- ✅ 자동 라벨링: `is_BCC_single`, `is_target_met` 등

---

## 📊 최종 결과물

### `data/master_dataset.csv` 예시

```
paper.paper_id | paper.source_ref | alloy.Ti_at | alloy.Nb_at | alloy.VEC | meas.YS_MPa | meas.elongation_pct | meas.is_target_met | ...
P001           | Wang et al.      | 20          | 20          | 4.4       | 953         | 42                  | 0                  | ...
P001           | Wang et al.      | 20          | 20          | 4.4       | 1050        | 35                  | 1                  | ...  (다온도 시험)
P002           | Senkov et al.    | 25          | 25          | 5.5       | 1200        | 25                  | 0                  | ...
...
```

- **행(row)**: 각각이 하나의 "측정(measurement)"
  - 같은 조성이라도 RT / 600°C 시험은 별개 행
  - 같은 합금의 다공정이면 별개 행
  
- **열(column)**: 모든 메타 + 조성 + 공정 + 물성 + 라벨이 평탄화되어 있음
  - 바로 pandas/scikit-learn의 학습 데이터로 사용 가능

---

## 💡 팁

**첫 1편만 테스트하고 싶다면:**

```bash
# inbox에 1개 파일만 놓고 실행
python scripts/extract_paper.py --batch

# 또는 파일 지정
python scripts/extract_paper.py papers/inbox/wang2023.pdf P001
```

**API 비용 확인:**
- PDF 1편당 약 $0.05 ~ $0.15 (Claude Sonnet 기준)
- 2편 테스트: 약 $0.10 ~ $0.30
- 20편 일괄: 약 $1 ~ $3

**시간이 너무 걸리면:**
- API 호출 시간이 대부분 (논문당 1~2분)
- Sonnet이 빠르지만, 더 빠르려면 Haiku도 가능 (정확도 낮을 수 있음)
