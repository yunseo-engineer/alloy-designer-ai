<<<<<<< HEAD
# HEA Designer — BCC 고엔트로피 합금 데이터 수집 파이프라인

PDF 논문 → Claude API 추출 → 검증 → descriptor 계산 → 통합 데이터셋(JSON + CSV) 까지를 자동화한 파이프라인입니다.

---

## 📁 폴더 구조

```
hea-designer/
├── papers/
│   ├── inbox/           ← 처리할 논문 PDF를 여기에 넣으세요
│   └── processed/       ← 처리 완료된 PDF가 자동으로 이동됩니다
│
├── data/
│   ├── extracted/       ← AI가 추출한 원본 JSON (논문당 1개)
│   ├── validated/       ← 검증 통과한 JSON
│   ├── master_dataset.json   ← 최종 통합 DB (전체 정규화 구조)
│   └── master_dataset.csv    ← 학습용 평탄화 테이블 (1행 = 1 측정)
│
├── schemas/
│   ├── bcc_hea_ai_collection_schema_v2.md   ← 데이터 스키마 정의
│   ├── element_property_table.csv           ← 원소 기준값 (descriptor 계산용)
│   └── miedema_matrix.csv                   ← Miedema 이원 합금 ΔH 행렬
│
├── scripts/
│   ├── extract_paper.py    ← PDF에서 데이터 추출
│   ├── validate.py         ← JSON 검증
│   ├── descriptor_calc.py  ← VEC, δ, ΔHmix 등 descriptor 계산
│   ├── build_dataset.py    ← 통합 데이터셋 빌드 + 라벨링
│   └── run_pipeline.py     ← 위 4개를 순서대로 실행
│
├── logs/                ← 처리 로그 (extraction.log 등)
├── .env.example         ← API 키 템플릿
├── .env                 ← 실제 API 키 (직접 만드세요, git 제외됨)
├── requirements.txt
└── README.md
```

---

## 🚀 처음 시작하는 5단계

### 1) Python 가상환경 + 패키지 설치

```bash
cd hea-designer
python -m venv .venv
source .venv/bin/activate     # macOS/Linux
# .venv\Scripts\activate      # Windows

pip install -r requirements.txt
```

### 2) API 키 설정

[Anthropic Console](https://console.anthropic.com)에서 API 키를 발급받은 뒤: 

```bash
cp .env.example .env
```

`.env` 파일을 열어 `ANTHROPIC_API_KEY=sk-ant-...` 자리에 본인 키를 붙여넣으세요.

> 📌 `.env`는 `.gitignore`에 포함되어 있어 git에 올라가지 않습니다.

### 3) 논문 또는 데이터 넣기

`papers/inbox/` 폴더에 다음 파일 형식 중 하나를 넣으면 됩니다:

| 형식 | 설명 | 예시 |
|---|---|---|
| **PDF** | 논문 전체 | `wang2023.pdf` |
| **CSV** | 표 데이터 | `composition_data.csv` |
| **Excel** | Supplementary 자료 | `supplement_table.xlsx` |
| **JSON** | 이미 정리된 데이터 | `hea_data.json` |
| **TXT/MD** | 텍스트 | `notes.txt` |

```
papers/inbox/
├── wang2023.pdf           # 논문 PDF
├── supplement_data.xlsx   # Supplementary 엑셀
├── measured_properties.csv # 측정 데이터 CSV
├── hea_composition.json   # 사전 정리 JSON
└── ...
```

각 파일은 자동으로 다른 파일 타입과 구분되어 처리됩니다.

### 4) 파이프라인 실행

가장 간단한 방법 — 모든 단계를 한 번에:

```bash
python scripts/run_pipeline.py
```

또는 단계별로 실행:

```bash
# 1단계: 추출 (모든 파일 형식 자동 처리)
python scripts/extract_paper.py --batch

# 또는 특정 파일만
python scripts/extract_paper.py papers/inbox/wang2023.pdf P001
python scripts/extract_paper.py papers/inbox/data.csv P002
python scripts/extract_paper.py papers/inbox/supplement.xlsx P003
```

### 5) 결과 확인

- `data/extracted/P001.json`, `P002.json`, ... — 논문별 원본 JSON
- `data/validated/` — 검증 통과한 것만
- `data/master_dataset.json` — 통합 DB
- `data/master_dataset.csv` — 학습용 평탄화 테이블
- `logs/extraction.log` 등 — 처리 기록

---

## 🔁 새 PDF 추가는 어떻게?

새 논문 PDF가 생기면 그냥 `papers/inbox/`에 넣고 다시 실행하세요:

```bash
python scripts/run_pipeline.py
```

- 이미 처리된 PDF는 `papers/processed/`로 이동되어 있어 중복 처리되지 않습니다.
- `paper_id`(P001, P002, ...)는 자동으로 다음 번호가 부여됩니다.

---

## 💡 자주 묻는 것

**Q. 추출이 잘못된 것 같아요. 다시 돌리려면?**

A. `data/extracted/P00X.json`을 지우고, `papers/processed/`에서 해당 PDF를 다시 `inbox/`로 옮긴 뒤 실행하세요.

**Q. 파일 형식을 섞어서 넣어도 되나요? (PDF, CSV, Excel 혼합)**

A. 네, 문제없습니다. `--batch`를 실행하면 inbox 폴더의 모든 파일을 자동으로 형식에 맞춰 처리합니다.
- PDF: Claude의 멀티모달 추출
- CSV/Excel: 표를 Claude가 스키마로 변환
- JSON: 검증만
- TXT/MD: 텍스트 파싱

**Q. Supplementary 엑셀은 어떻게 처리되나요?**

A. `papers/inbox/supplement.xlsx` 형태로 넣으면, Claude가 표의 각 행을 알아서 composition/properties로 분류해 JSON으로 변환합니다. 자동 완벽하지 않을 수 있으므로 첫 1~2개 결과를 검토한 뒤 나머지를 돌리세요.

**Q. API 호출 비용이 걱정됩니다.**

A. PDF 1편당 대략 $0.05 ~ $0.15 정도입니다 (Claude Sonnet 기준). 200편이면 $10~30 수준입니다. 처음 1~2편으로 결과 품질을 먼저 확인한 뒤 일괄 처리하세요.

**Q. JSON 결과를 직접 수정해도 되나요?**

A. 네, `data/extracted/` 또는 `data/validated/`의 JSON을 직접 수정한 뒤 `descriptor_calc.py`와 `build_dataset.py`를 다시 돌리면 됩니다.

**Q. 추출 품질이 떨어지면 어떻게 개선하나요?**

A. `scripts/extract_paper.py`의 `SYSTEM_PROMPT`와 `build_user_prompt()`를 수정하면 됩니다. 처음 5~10편 결과를 직접 검토해 자주 누락되는 필드 패턴을 파악한 뒤 프롬프트에 강조 지시를 추가하세요.

---

## 📊 데이터 스키마

상세한 컬럼 정의는 `schemas/bcc_hea_ai_collection_schema_v2.md`를 참고하세요.

핵심 구조:

```
papers (논문 메타데이터)
  └── alloys (조성 + descriptor)
        └── samples (공정 조건)
              └── measurements (시험 조건별 물성)
```

학습 단위는 `measurement` 입니다. 같은 합금이라도 RT/600°C/800°C 시험은 각각 별도 행입니다.

---

## ⚠️ 주의사항

1. **API 키 보안**: `.env` 파일은 절대 git에 올리지 마세요.
2. **저작권**: 논문 PDF는 `.gitignore`에 포함되어 있습니다. 외부 공유 금지.
3. **추출 결과 신뢰도**: AI 추출이 100% 정확하지 않습니다. 처음에는 반드시 직접 검토하세요.
4. **descriptor 재현성**: `schemas/element_property_table.csv`와 `miedema_matrix.csv`를 임의로 수정하지 마세요. 변경 시 `descriptor_calc.py`의 `DESCRIPTOR_TABLE_VERSION`을 올리고 전체 재계산해야 합니다.
=======
# Capstone Design Project 
## HEA Designer — BCC High-Entropy Alloy Design Platform
> AI 기반 BCC 고엔트로피 합금 조성·공정 자동 설계 플랫폼 (1년 프로젝트)

---

## 1. 프로젝트 개요

### 한 줄 요약
논문 PDF에서 멀티모달 LLM으로 데이터를 자동 추출하고, 머신러닝 예측 모델과 RAG 기반 추천 시스템을 결합하여 **항복강도 > 1000 MPa, 연신율 > 30%** 를 목표로 하는 BCC 단상 고엔트로피 합금(HEA)을 설계·추천하는 플랫폼.

### 문제 인식
- 전통적 합금 개발은 경험·휴리스틱·시행착오에 의존 → 속도와 탐색 범위의 한계
- 고엔트로피 합금(HEA)은 다원소 조합 + 공정 변수까지 포함하면 조성 공간이 5원계 기준 10²⁰ 이상
- 기존 계산 프로그램(CALPHAD): 라이선스 비용 5천만 원 이상, 목표 물성 역설계 불가, 긴 연산 시간
- 문헌 데이터는 방대하지만 구조화되지 않아 사람이 읽고 정리하기엔 이미 과잉 상태

### 설계 범위
- **합금계**: BCC 계열 Refractory High-Entropy Alloys (RHEAs)
- **대상 원소**: Ti, Zr, Hf, Nb, Ta, V, Mo, W, Cr, Al (10종)
- **목표 물성**:
  - 항복강도 (YS) > 1000 MPa
  - 연신율 (Elongation) > 30%
- **설계 대상**: 조성 설계 + 열·가공 공정 (Thermo-mechanical processing)

---

## 2. 핵심 목표 (KPI)

| 목표 | 지표 | 기준값 |
|---|---|---|
| BCC 단상 형성 | XRD, EBSD 확인 | BCC fraction > 90% |
| 항복강도 | 인장 시험 | YS > 1000 MPa (목표: 1050–1100 MPa) |
| 연신율 | 인장 시험 | Elongation > 30% |
| 데이터 추출 정확도 | Extraction F1 | > 85% (HIGH confidence 기준) |
| 모델 예측 정확도 | R² / RMSE | R² > 0.80 (cross-validation) |

---

## 3. 전체 파이프라인

```
[Phase 1] 코퍼스 수집
    논문 PDF (Semantic Scholar, Scopus, 수동 수집)
    공개 DB (AFLOW, ICSD, Citrine, Gorsse Data Brief)
    Supplementary 자동 감지 및 연결
         ↓
[Phase 2] 멀티모달 추출 (Claude Sonnet API)
    텍스트 → 조성·공정·물성 구조화 JSON
    표 → 정규화 테이블
    그림 → XRD 피크, 응력-변형 곡선 수치 추출
    추출 신뢰도 점수 부여 (HIGH / MED / LOW)
         ↓
[Phase 3] 전처리 및 Descriptor 자동 계산
    조성 정규화 (원소 분율 합산 = 100 at% 검증)
    VEC, δ, ΔHmix, ΔSmix, Tm 자동 산출
    데이터 품질 계층 분류
    NaN 허용 — 타겟별 선택적 학습
         ↓
[Phase 4] AI 예측 모델
    XGBoost / CatBoost 멀티태스크 (YS + 연신율 동시 예측)
    NGBoost / Bayesian으로 불확실도 정량화
    SHAP으로 설계 인자 해석 및 원소별 기여도 시각화
         ↓
[Phase 5] 능동 학습 루프 (Active Learning)
    Bayesian Optimization → 다음 실험 조성 자동 제안
    Expected Improvement 기반 실험 우선순위 계산
         ↓
[Phase 6] RAG 기반 추천 시스템
    3계층 근거 구조화 (실험 결과 / 상 형성 규칙 / 열역학 추론)
    예측 점수 + 문헌 근거 + 불확실도 결합 ranking
    LangChain 기반 구현
         ↓
[Phase 7] 실험 검증 (Arc 용해 → XRD / SEM / EBSD / 인장 시험)
    성공·실패 데이터 모두 태깅 후 재학습
    격주 단위 모델 업데이트 (폐루프)
         ↓
[Phase 8] 웹 플랫폼 배포
    자연어 질의 → 조성·공정 추천 대시보드
    논문 업로드 → 자동 추출 → DB 적재 기능 포함
```

---

## 4. 데이터 수집 목표

- **논문 수**: 150–200편
- **데이터 포인트**: 400–600개 (샘플 단위)
- **수집 우선순위**: Nature / Science / PNAS → Acta Mater. / Scripta Mater. → npj Comp. Mater. / J. Alloys Compd.

---

## 5. AI 모델 설계

### 5-1. 예측 모델 구조

```
[1단계] XGBoost / CatBoost 앙상블
    입력: 조성 분율 + Descriptor (VEC, δ, ΔHmix 등) + 공정 변수
    출력: YS (MPa), 연신율 (%) 동시 예측 (멀티태스크)
    해석: SHAP으로 원소별 기여도 분석

[2단계] NGBoost / Monte Carlo Dropout
    목적: 예측값 + 신뢰 구간 (불확실도 정량화)
    활용: 실험 우선순위 결정 (기댓값 높고 불확실도 높은 조성 먼저)

[3단계] Bayesian Optimization 루프
    목적: 다음 실험 조성 자동 제안
    방법: Expected Improvement (EI) 기반 능동 학습
    효과: 실험 횟수 최소화하면서 최적 조성 수렴
```

### 5-2. Phase 안정성 필터 (BCC 단상 조건)

ML 모델이 추천하는 조성은 아래 물리 기반 조건을 모두 만족해야 함:

- 0 ≤ δ ≤ 8.5
- −22 ≤ ΔHmix ≤ 7 kJ/mol
- 11 ≤ ΔSmix ≤ 19.5 J/(K·mol)
- VEC < 6.87 (BCC 안정 영역)

### 5-3. RAG 기반 추천 시스템

- 구현 도구: LangChain + vector DB (FAISS 또는 ChromaDB)
- 근거를 3계층으로 구조화하여 신뢰도 제공:
  1. **계층 1** — 동일/유사 조성의 실험 결과 (가장 강한 근거)
  2. **계층 2** — 동일 원소계의 상 형성 규칙
  3. **계층 3** — 물리·열역학적 Descriptor 기반 추론

---

## 6. 실험 검증 계획

### 6-1. 합금 제조
- 장비: Arc 용해 장비 (고순도 합금 주조)
- 조건: 고순도 원소 (순도 ≥ 99.95 wt%), Ti-gettered Ar 분위기, 10회 이상 재용해
- 공정: 냉간압연 (80% 압하율) → 어닐링 (1000°C, 5 min, 수냉)

### 6-2. 검증 실험

| 실험 | 검증 목적 |
|---|---|
| XRD | BCC 단상 여부 확인 |
| SEM + EDS | 미세조직 및 원소 분포 확인 |
| EBSD | 결정립 크기, 결정 방위 분석 |
| Hardness (Vickers) | 경도 측정 |
| 인장 시험 | 항복강도, 연신율 측정 |

### 6-3. 폐루프 피드백
- 실험 결과 (성공·실패 모두) → 데이터셋 재학습
- 실패 조성도 "네거티브 학습 데이터"로 태깅하여 활용
- 격주 단위 모델 업데이트
- 검증 지표: 재학습 후 R² 향상 폭, RMSE 감소율

---

## 7. 웹 플랫폼 설계

### 7-1. 핵심 기능

| 기능 | 설명 |
|---|---|
| 자연어 질의 | "Ti-Nb-Hf 계에서 연신율 30% 이상 확보" 등 조건 입력 |
| 조성 추천 | 상위 후보 3종 + 물성 예측값 + 신뢰 구간 출력 |
| 공정 설계 | 주조·압연·어닐링 단계별 타임라인 출력 |
| 문헌 근거 | 참고 논문 + 3계층 근거 + 주의사항 제시 |
| 비교 시각화 | 레이더 차트로 후보 조성 다중 비교 |
| 논문 업로드 | PDF 업로드 → 자동 추출 → DB 적재 (검토 UI 포함) |
| SHAP 해석 | 원소별 물성 기여도 시각화 |
| 실험 로그 | 실험 결과 입력 → 모델 재학습 트리거 |

### 7-2. 기술 스택

- Frontend: Next.js + Tailwind CSS + Recharts
- Backend: Python (FastAPI)
- AI: Claude Sonnet API (추출 + 질의응답), XGBoost, LangChain
- DB: CSV / Parquet (학습용), SQLite (로그)
- 배포: Vercel (프론트) + Railway 또는 Render (백엔드)

### 7-3. 질의응답 예시

**Q**: 우주항공 엔진 부품에 적용할 내화 HEA를 설계해줘. W, Mo, Ta, Nb 계열로 1200°C 이상 고온에서 BCC 단상을 유지하면서 항복강도를 극대화할 조성 3가지와 열처리 조건을 알려줘.

**A 출력 구조**:
- 조성 추천 카드 3종 (원소 바차트 + YS/연신율/밀도/BCC 안정성 예측값)
- 목표 달성 여부 (✅ / ⚠️)
- 공정 타임라인 (균질화 → 열간압연 → 어닐링)
- 문헌 근거 (Senkov et al. 2018, Li et al. 2020 등)
- 주의사항 (W > 30 at% 시 σ상 형성 위험 등)
- 레이더 차트 (3가지 조성 동시 비교)
**
>>>>>>> 2f54d5f84c8a36ec97a2112061174eb5e24b16a6
