# BCC 단상 고엔트로피 합금 설계 플랫폼 데이터 수집 스키마 v2

> **변경 이력**
> - v1 → v2: 시험 모드/온도 분리, 다단계 공정 흡수, descriptor 기준값 테이블 명시, 미세조직·시험편 정보 추가, 다중 테이블 정규화 구조 도입, 결측치 분류 세분화, 고온 물성 행 분리 정책 확정.

---

## 1. 문서 목적

BCC 단상 고엔트로피 합금(High-Entropy Alloy, HEA) 설계 플랫폼 구축을 위해 논문 PDF·표·그림·보충자료에서 정보를 추출·검증·저장할 때 AI와 사람이 따라야 할 표준 수집 기준서이다.

이 문서는 다음을 동시에 만족하도록 설계되었다.

1. 멀티모달 LLM이 일관된 JSON으로 추출할 수 있을 것
2. 재료공학적으로 의미 있는 조성·공정·물성 변수를 빠짐없이 보존할 것
3. 머신러닝 학습 시 정보 누락·단위 혼재·라벨 누설(leakage) 위험을 최소화할 것
4. 데이터 출처와 신뢰도를 항상 추적 가능하게 할 것

---

## 2. 핵심 원칙

1. 원문에 명시된 값은 가능한 한 그대로 보존한다.
2. 자동 계산 가능한 descriptor는 조성 확정 후 별도 스크립트로 계산한다.
3. 직접 추출값(measured)과 자동 계산값(computed)을 혼동하지 않는다.
4. 결측값, 미포함 원소, 추정값을 명확히 구분한다.
5. 모델 학습용 target과 운영 라벨은 별도 그룹으로 관리한다.
6. 모든 수치는 단위와 근거 문장(evidence_span)을 함께 남긴다.
7. **하나의 합금에 대해 여러 공정·시험 조건이 존재하면 별도 행(row)으로 분리한다.**
8. 사용한 원소 기준 물성값 테이블은 데이터셋과 함께 버전 고정한다.

---

## 3. 데이터 구조 — 다중 테이블 정규화

v1의 단일 테이블 구조는 한 논문에서 동일 조성·다공정 또는 다온도 시험이 보고될 때 metadata 중복과 행 폭증 문제가 발생한다. v2는 다음과 같이 4개 테이블로 정규화하되, 분석 시 JOIN으로 단일 평면 테이블을 생성한다.

```
papers              (그룹 A)         — 1 row per paper
   │
   └── alloys       (그룹 B, C)      — 1 row per (paper, composition)
          │
          └── processed_samples  (그룹 D)  — 1 row per (alloy, process_condition)
                 │
                 └── property_measurements (그룹 E, F) — 1 row per (sample, test_condition)
```

### 3.1 키 구조

| 테이블 | Primary Key | Foreign Key |
|---|---|---|
| `papers` | `paper_id` | — |
| `alloys` | `alloy_id` | `paper_id` |
| `processed_samples` | `sample_id` | `alloy_id` |
| `property_measurements` | `measurement_id` | `sample_id` |

`measurement_id`가 모델 학습 단위가 되며, 각 measurement는 자신이 속한 sample, alloy, paper의 정보를 모두 JOIN해 사용한다.

---

## 4. 공통 수집 규칙

### 4.1 결측값 규칙 (확장)

| 상황 | 저장값 | 보조 플래그 | 의미 |
|---|---:|---|---|
| 원소가 합금에 포함되지 않음 | `0` | — | 해당 원소 부재 (확정) |
| 논문에 정보 미기재 | `NaN` | `field_status = "not_reported"` | 정보 없음 |
| 본문에 측정 안 함 명시 | `NaN` | `field_status = "not_measured"` | 측정 자체가 없음 |
| 값은 있으나 단위 불명확 | 원문값 | `extraction_confidence = MED` | 검수 필요 |
| 그림에서 읽은 추정값 | 추정값 | `extraction_confidence = MED` | 표보다 낮은 신뢰도 |
| AI 추론이 개입된 값 | 추정값 | `extraction_confidence = LOW` | evidence_span 필수 |
| 이전 단계 결과 그대로 사용(예: as-cast) | 해당 단계 NaN | `as_cast_flag = 1` 또는 `processing_skipped_flag = 1` | 가공/열처리 미시행 |

> **중요**: NaN의 의미가 "측정 안 함"인지 "보고 안 함"인지 "해당 단계 없음"인지를 명확히 구분해야 모델이 결측 패턴을 학습하지 않는다.

### 4.2 신뢰도 등급

| 등급 | 기준 | 예시 |
|---|---|---|
| `HIGH` | 표·본문 수치가 명확, DOI 확정 | 표에 `YS = 953 MPa` 명시 |
| `MED` | 단위 불명확, 그래프 디지타이즈 | 응력-변형 곡선에서 YS 추정 |
| `LOW` | 문맥 추론 필요, 간접 제시 | "near room temperature" → 25°C |

### 4.3 evidence_span 규칙

- 모든 핵심 target 값에는 원문 근거 문장 또는 표/그림 위치를 기록한다.
- `extraction_confidence`가 `MED` 또는 `LOW`인 경우 `evidence_span`은 필수.
- 그림 기반 추출값은 `Figure 3 stress-strain curve` 형태로 위치 명시.
- 보충자료에서 추출한 경우 `Supplementary Table S2`처럼 명시.

### 4.4 단위 표준화

| 항목 | 표준 단위 | 비고 |
|---|---|---|
| 조성 | `at%` | wt% 보고 시 변환, 변환 로그 필수 |
| 온도 | `°C` (descriptor의 융점만 `K`) | 컬럼명에 단위 포함 |
| 시간 | `h` 또는 `min`, 컬럼명에 명시 | 혼용 금지 |
| 강도 (YS, UTS) | `MPa` | |
| 연신율 | `%` | |
| 결정립 크기 | `μm` (나노결정 시 `nm` 병기 컬럼) | 측정법 함께 기록 |
| 밀도 | `g/cm³` | (v1의 `g/cc`는 동일하지만 표준 표기로 통일) |
| 혼합 엔탈피 | `kJ/mol` | |
| 혼합 엔트로피 | `J/(K·mol)` | |
| 변형속도 | `s⁻¹` | |
| 격자상수 | `Å` | |
| 냉각속도 | `K/s` | |
| Interstitial 함량 | `wt ppm` | O, N, C, H |

---

## 5. 그룹 A — 출처 정보 (테이블: `papers`)

### 5.1 컬럼 정의

| 컬럼명 | 타입 | 필수 | 설명 | 예시 |
|---|---|---:|---|---|
| `paper_id` | string | O | 논문 고유 번호 (DB JOIN key) | `P001` |
| `source_ref` | string | O | 저자·저널·연도 문자열 | `Wang et al., Acta Mater. 2023` |
| `doi` | string | 권장 | DOI 문자열 | `10.1016/j.actamat.2023.01.001` |
| `title` | string | 권장 | 논문 제목 | — |
| `journal` | string | 권장 | 저널명 | `Acta Materialia` |
| `pub_year` | integer | 권장 | 출판 연도 | `2023` |
| `corresponding_author` | string | 선택 | 교신저자명 | — |
| `pdf_path` | string | O | 로컬 PDF 경로 | `papers/P001.pdf` |
| `pdf_hash_md5` | string | O | 중복 검출용 해시 | `a3f2...` |
| `has_supplementary` | integer | O | SI 존재 여부 (0/1) | `1` |
| `extraction_model_version` | string | O | 추출에 쓰인 LLM 모델명·버전 | `claude-sonnet-4-5_2025-09-01` |
| `extraction_timestamp` | datetime | O | 추출 시각 | `2026-04-26T10:00:00Z` |
| `extraction_confidence` | category | O | 전체 추출 신뢰도 | `HIGH / MED / LOW` |
| `data_source_type` | category | O | 추출 출처 종류 | `text / table / figure / supplementary / mixed` |
| `evidence_span` | string | O | 추출 근거 문장 또는 위치 | `XRD confirmed single-phase BCC structure.` |
| `manual_review_status` | category | O | 검수 상태 | `pending / passed / rejected / needs_revision` |
| `reviewer_id` | string | 선택 | 검수자 식별자 | — |

---

## 6. 그룹 B — 조성 정보 (테이블: `alloys`, 일부)

### 6.1 컬럼 정의

| 컬럼명 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| `alloy_id` | string | O | (`paper_id` + 조성 인덱스) 합성 키 |
| `paper_id` | string | O | FK → papers |
| `composition_raw` | string | O | 논문 원문 조성 표기 |
| `composition_basis` | category | O | `at%` 또는 `wt%` (원문 기준) |
| `Ti_at`, `Zr_at`, `Hf_at`, `Nb_at`, `Ta_at`, `V_at`, `Mo_at`, `W_at`, `Cr_at`, `Al_at` | float | O | 원소별 at%, 미포함은 `0` |
| `other_elements_json` | string | 선택 | 대상 원소 외 함유 원소 (예: `{"Si": 0.5, "B": 0.1}`) |
| `n_elements` | integer | O | 0보다 큰 원소 수 (대상+기타 합산) |
| `composition_sum_at` | float | O | 원소 함량 합계 |
| `composition_valid_flag` | integer | O | 합계 99.8–100.2 통과 여부 |
| `composition_normalized_flag` | integer | O | 정규화 적용 여부 (1이면 합산이 100으로 강제됨) |
| `composition_source` | category | O | `text / table / abstract / supplementary` |
| `wt_to_at_atomic_mass_version` | string | 조건부 필수 | wt% 변환 시 사용한 원자량 테이블 버전 (예: `IUPAC_2021`) |
| `composition_note` | string | 선택 | 변환·정규화 등 특이사항 |

### 6.2 핵심 규칙

- 미포함 원소는 반드시 `0` (NaN 금지).
- 대상 10원소 외 의도적 첨가(B, Si, C 등)는 `other_elements_json`에 별도 보존하되, 모델 입력에는 포함하지 않거나 별도 컬럼으로 명시 학습.
- wt% → at% 변환 시 사용한 원자량 출처(`IUPAC_2021` 등)를 반드시 기록.
- 합계가 99.8–100.2 범위를 벗어나면 정규화 여부와 정규화 전 합산 값을 모두 보존.

---

## 7. 그룹 C — 물리 Descriptor (테이블: `alloys`, 일부)

### 7.1 원소 기준 물성값 테이블 (필수 첨부)

descriptor 재현성을 위해 다음 원소 물성값 테이블을 데이터셋과 함께 버전 고정해 배포한다. 변경 시 `descriptor_table_version`을 올리고 전체 재계산한다.

| 원소 | r (Å) | χ (Pauling) | VEC | Tm (K) | ρ (g/cm³) | M (g/mol) | G (GPa) | B (GPa) |
|---|---|---|---|---|---|---|---|---|
| Ti | 1.462 | 1.54 | 4 | 1941 | 4.51 | 47.87 | 44 | 110 |
| Zr | 1.603 | 1.33 | 4 | 2128 | 6.51 | 91.22 | 33 | 91.1 |
| Hf | 1.580 | 1.30 | 4 | 2506 | 13.31 | 178.49 | 30 | 110 |
| V | 1.316 | 1.63 | 5 | 2183 | 6.11 | 50.94 | 47 | 160 |
| Nb | 1.429 | 1.60 | 5 | 2750 | 8.57 | 92.91 | 38 | 170 |
| Ta | 1.430 | 1.50 | 5 | 3290 | 16.69 | 180.95 | 69 | 200 |
| Cr | 1.249 | 1.66 | 6 | 2180 | 7.19 | 52.00 | 115 | 160 |
| Mo | 1.363 | 2.16 | 6 | 2896 | 10.28 | 95.95 | 120 | 230 |
| W | 1.367 | 2.36 | 6 | 3695 | 19.25 | 183.84 | 161 | 310 |
| Al | 1.432 | 1.61 | 3 | 933 | 2.70 | 26.98 | 26 | 76 |

> 출처: Takeuchi & Inoue (2005) 원자반경, IUPAC 2021 원자량, CRC Handbook 95th ed. 기타 물성값. 변경 시 반드시 `descriptor_table_version`을 갱신하고 데이터셋 재계산.

### 7.2 Binary 혼합 엔탈피 행렬 (Miedema)

ΔHmix 계산은 단순 Σcᵢ·Hᵢ가 아니라 binary pair 기준이다.

```
ΔHmix = Σᵢ<ⱼ 4 · Hᵢⱼ · cᵢ · cⱼ
```

여기서 `Hᵢⱼ`는 i-j 이원합금의 1:1 조성 기준 Miedema 혼합 엔탈피 (kJ/mol). 10×10 대칭 행렬을 별도 파일(`miedema_matrix_v1.csv`)로 관리하며, 출처는 Takeuchi & Inoue (2005) Table 2 값을 사용한다. 행렬도 `descriptor_table_version`에 종속.

### 7.3 컬럼 정의

| 컬럼명 | 타입 | 필수 | 계산식 | 비고 / 임계값 |
|---|---|---:|---|---|
| `VEC` | float | O | Σcᵢ·VECᵢ | `< 6.87` BCC 우선 |
| `delta_pct` | float | O | √(Σcᵢ(1−rᵢ/r̄)²) × 100 | `0 ≤ δ ≤ 8.5` |
| `dH_mix_kJ` | float | O | Σᵢ<ⱼ 4·Hᵢⱼ·cᵢ·cⱼ | `−22 ~ +7` |
| `dS_mix_J` | float | O | −R·Σcᵢ·ln(cᵢ) (R = 8.314) | `11 ~ 19.5` |
| `Tm_mix_K` | float | O | Σcᵢ·Tmᵢ (rule of mixtures) | |
| `Tm_std_K` | float | 권장 | √(Σcᵢ(Tmᵢ−T̄m)²) | 융점 분산 |
| `density_calc_gcm3` | float | 권장 | (Σcᵢ·Mᵢ) / (Σcᵢ·Mᵢ/ρᵢ) | 룰 오브 믹스처 밀도 |
| `Omega` | float | O | Tm_mix·ΔSmix / \|ΔHmix\| | `≥ 1.1`이면 고용체 우선 |
| `delta_chi` | float | O | √(Σcᵢ(χᵢ−χ̄)²) | `< 0.133` 고용체 |
| `chi_mean` | float | 권장 | Σcᵢ·χᵢ | |
| `r_mean_A` | float | 권장 | Σcᵢ·rᵢ | |
| `G_mean_GPa` | float | 권장 | Σcᵢ·Gᵢ | YS 보조 피처 |
| `B_mean_GPa` | float | 권장 | Σcᵢ·Bᵢ | 압축 강도 보조 |
| `Lambda` | float | 권장 | ΔSmix / δ² | Solid solution tendency |
| `e_a_ratio` | float | 권장 | VEC와 별도. e/a (Hume-Rothery) | |
| `APE` | float | 선택 | atomic packing efficiency | |
| `VEC_definition` | category | O | `Guo` 또는 `Wang` (d-band 포함 여부) | 정의 차이 명시 |
| `descriptor_table_version` | string | O | 사용한 원소 물성값 테이블 버전 | `desc_v1.0` |
| `descriptor_calc_script_version` | string | O | 계산 스크립트 git tag | `calc_v1.2` |

### 7.4 주의사항

- **`|ΔHmix|` 절댓값 처리**: Ω 계산 시 분모는 항상 절댓값. 실제 ΔHmix가 양수일 때 부호를 잃지 않도록 `dH_mix_kJ`에는 부호 포함값 저장.
- **VEC 정의 차이**: Guo et al.(2011) 정의는 d-block 원소의 d 전자를 포함, 일부 논문은 외각 전자만 포함. 본 프로젝트는 **Guo 정의**(완전한 외각 + d 전자)를 표준으로 한다. `VEC_definition` 컬럼에 명시.
- **단위 일관성**: r은 Å, Tm은 K, ΔHmix는 kJ/mol. 입력 단위와 계산 단위 혼동 시 Ω가 1000배 어긋나는 사고가 흔함.
- 논문에 descriptor 값이 명시되어 있으면 `*_paper` 접미사 컬럼에 별도 저장하고 자체 계산값과 비교 로그를 남긴다.

---

## 8. 그룹 D — 공정 정보 (테이블: `processed_samples`)

### 8.1 핵심 변경: 다단계 공정 흡수

v1의 단일 어닐링 컬럼 구조는 다단계 열처리(homogenization → 1차 anneal → 2차 anneal)를 표현 못 한다. v2는 두 가지 표현을 모두 제공:

- **structured columns**: 가장 자주 쓰이는 단계는 컬럼으로 (검색·필터 용이)
- **process_steps_json**: 전체 공정 시퀀스를 JSON 배열로 보존 (재현 용이)

### 8.2 컬럼 정의

| 컬럼명 | 타입 | 필수 | 설명 | 예시 |
|---|---|---:|---|---|
| `sample_id` | string | O | (`alloy_id` + 공정 인덱스) | `P001_A1_S1` |
| `alloy_id` | string | O | FK → alloys | |
| **— 용해/제조 —** | | | | |
| `melting_route` | category | O | 제조법 | `arc_melting / vacuum_arc_melting / induction / SPS / LENS / EBM / cold_crucible` |
| `remelt_times` | integer | 권장 | 재용해 횟수 | `10` |
| `melting_atmosphere` | category | 권장 | 분위기 | `Ar / Ti-gettered_Ar / vacuum / He / air` |
| `raw_material_purity_min_wt_pct` | float | 권장 | 원소 최소 순도 | `99.95` |
| `as_cast_flag` | integer | O | 주조 후 추가 가공 없음 (0/1) | `0` |
| **— 균질화 —** | | | | |
| `homog_temp_C` | float | 선택 | 균질화 온도 | `1200` |
| `homog_time_h` | float | 선택 | 균질화 시간 | `24` |
| `homog_atmosphere` | category | 선택 | 분위기 | `Ar / vacuum / encapsulated` |
| **— 가공 —** | | | | |
| `deform_type` | category | 선택 | 가공 방법 | `cold_rolling / hot_rolling / cross_rolling / forging / extrusion / swaging / ECAP / HPT / none` |
| `deform_temp_C` | float | 선택 | 가공 온도 (열간/온간 시) | `25` |
| `reduction_pct` | float | 선택 | 누적 압하율/단면감소율 | `80` |
| `pass_count` | integer | 선택 | 패스 수 | `20` |
| **— 어닐링 (1차) —** | | | | |
| `anneal_temp_C` | float | 선택 | 어닐링 온도 | `1000` |
| `anneal_time_value` | float | 선택 | 어닐링 시간 (수치) | `5` |
| `anneal_time_unit` | category | 선택 | `s / min / h` | `min` |
| `anneal_atmosphere` | category | 선택 | 분위기 | `Ar / vacuum / encapsulated_in_quartz / air` |
| **— 냉각 —** | | | | |
| `cooling_method` | category | 선택 | 냉각법 | `WQ / oil_quench / air_cool / furnace_cool / He_quench` |
| `cooling_rate_K_per_s` | float | 선택 | 측정/추정 냉각속도 | `100` |
| **— 다단계 공정 (전체) —** | | | | |
| `process_steps_json` | string | O | 전체 공정 시퀀스 JSON 배열 | (아래 예시 참조) |
| `n_process_steps` | integer | O | 단계 수 | `4` |
| **— 시편 —** | | | | |
| `specimen_geometry` | category | 권장 | 시편 형태 | `dog_bone / cylinder / cube / micropillar / sheet` |
| `specimen_thickness_mm` | float | 선택 | 시편 두께/직경 | `1.5` |
| `gauge_length_mm` | float | 선택 | 인장 게이지 길이 | `10` |
| **— Interstitial 분석 —** | | | | |
| `O_content_wt_ppm` | float | 선택 | 산소 함량 | `350` |
| `N_content_wt_ppm` | float | 선택 | 질소 함량 | `120` |
| `C_content_wt_ppm` | float | 선택 | 탄소 함량 | `80` |
| `interstitial_method` | category | 선택 | 분석법 | `LECO / ICP-OES / GDMS` |
| **— 메타 —** | | | | |
| `processing_skipped_flag` | integer | O | 공정 섹션 자체 부재 | `0` |
| `process_evidence_span` | string | 조건부 필수 | 공정 추출 근거 | |

### 8.3 `process_steps_json` 예시

```json
[
  {"order": 1, "type": "arc_melting", "remelt": 10, "atmosphere": "Ti-gettered_Ar"},
  {"order": 2, "type": "homogenization", "temp_C": 1200, "time_h": 24, "atmosphere": "Ar"},
  {"order": 3, "type": "cold_rolling", "reduction_pct": 80, "passes": 20, "temp_C": 25},
  {"order": 4, "type": "annealing", "temp_C": 1000, "time_min": 5, "atmosphere": "Ar"},
  {"order": 5, "type": "cooling", "method": "WQ", "rate_K_per_s": 200}
]
```

### 8.4 시간 단위 표준화

v1은 `anneal_time_min` 한 컬럼이라 hour 보고 시 변환에서 오류 가능성이 있었다. v2는 (값, 단위) 쌍으로 저장하고, 분석 시 별도 파생 컬럼 `anneal_time_min_normalized`를 계산해 사용한다.

### 8.5 산소 함량 중요성

RHEA의 강도와 취성은 interstitial O 함량에 매우 민감(특히 Ti, Zr, Hf 함유계). 산소 200 ppm 차이로 YS가 100–200 MPa 변동하기도 한다. 모든 데이터 포인트에 포함되는 것은 아니지만, 보고된 경우 반드시 추출.

---

## 9. 그룹 E — 결과 물성 (테이블: `property_measurements`)

### 9.1 핵심 변경: 시험 조건을 측정 단위로 분리

같은 sample이라도 RT/600°C/800°C 인장이 따로 보고되면 각각이 독립 measurement_id가 된다. 이렇게 해야 모델 입력 시 `test_temp_C`가 피처가 되고, 동일 합금의 온도 의존성을 학습할 수 있다.

### 9.2 컬럼 정의

| 컬럼명 | 타입 | 필수 | 설명 | 예시 |
|---|---|---:|---|---|
| `measurement_id` | string | O | 측정 고유 키 | `P001_A1_S1_M1` |
| `sample_id` | string | O | FK → processed_samples | |
| **— 시험 조건 —** | | | | |
| `test_mode` | category | O | 시험 종류 | `tensile / compression / micropillar_compression / nanoindentation / bending / hardness_only` |
| `test_temp_C` | float | O | 시험 온도 | `25` |
| `test_atmosphere` | category | 권장 | 시험 분위기 | `air / Ar / vacuum` |
| `strain_rate_per_s` | float | 권장 | 변형속도 | `1e-3` |
| `n_specimens` | integer | 권장 | 시험편 수 | `3` |
| **— 상 정보 —** | | | | |
| `phase_structure` | string | O | 원문 상 구조 문자열 | `BCC single-phase` |
| `BCC_fraction_pct` | float | 권장 | BCC 분율 | `100` |
| `phase_quantification_method` | category | 권장 | 분율 정량법 | `Rietveld / peak_intensity_ratio / EBSD_phase_map / TEM_estimate` |
| `secondary_phase` | category | 권장 | 2차상 종류 | `none / Laves / sigma / omega / B2 / HCP / FCC / amorphous` |
| `secondary_phase_fraction_pct` | float | 선택 | 2차상 분율 | `5` |
| `lattice_param_a_A` | float | 선택 | BCC 격자상수 a | `3.245` |
| `ordering_present` | category | 선택 | 규칙화 | `none / B2 / D03 / suspected` |
| `phase_id_method` | category | 권장 | 상 동정법 | `XRD / TEM-SAED / neutron_diffraction / synchrotron / EBSD` |
| **— 미세조직 —** | | | | |
| `grain_size_um` | float | 선택 | 평균 결정립 크기 | `63.18` |
| `grain_size_method` | category | 권장 | 측정법 | `EBSD / linear_intercept / SEM / optical / XRD_Scherrer` |
| `grain_size_type` | category | 선택 | 통계 종류 | `mean / median / D50 / D90` |
| `recrystallization_pct` | float | 선택 | 재결정 분율 | `85` |
| `texture_index` | float | 선택 | 집합조직 강도 | `2.3` |
| `dislocation_density_m2` | float | 선택 | 전위밀도 | `1.5e15` |
| `precipitate_size_nm` | float | 선택 | 석출물 평균 크기 | `25` |
| `precipitate_fraction_pct` | float | 선택 | 석출 분율 | `8` |
| **— 강도/연성 —** | | | | |
| `YS_MPa` | float | 권장 | 항복강도 (0.2% offset 기준) | `953` |
| `YS_offset_method` | category | 권장 | offset 기준 | `0.2pct / proportional_limit / lower_yield` |
| `UTS_MPa` | float | 선택 | 인장/압축 최대응력 | `1100` |
| `elongation_pct` | float | 권장 | 파단 연신율 | `42` |
| `uniform_elong_pct` | float | 선택 | 균일 연신율 | `15` |
| `reduction_of_area_pct` | float | 선택 | 단면감소율 | `30` |
| `n_WH` | float | 선택 | Hollomon 가공경화 지수 | `0.23` |
| `K_WH_MPa` | float | 선택 | Hollomon 강도계수 | `1500` |
| **— 통계 산포 —** | | | | |
| `YS_MPa_std` | float | 선택 | YS 표준편차 | `30` |
| `YS_MPa_min` | float | 선택 | 보고 범위 하한 | `920` |
| `YS_MPa_max` | float | 선택 | 보고 범위 상한 | `980` |
| `elongation_pct_std` | float | 선택 | 연신율 표준편차 | `4` |
| **— 경도 / 인성 —** | | | | |
| `hardness_HV` | float | 선택 | Vickers 경도 | `320` |
| `hardness_load_kgf` | float | 선택 | 시험 하중 | `1` |
| `KIC_MPa_m05` | float | 선택 | 파괴인성 (있으면) | `35` |
| `charpy_J` | float | 선택 | 샤르피 충격값 | `12` |
| **— 파면 —** | | | | |
| `fracture_mode` | category | 선택 | 파괴 모드 | `ductile / brittle / mixed / cleavage / intergranular` |
| **— 대리 추정 —** | | | | |
| `YS_estimated_from_HV_MPa` | float | 선택 | HV 기반 추정 YS | `1046` |
| `YS_source_type` | category | O | YS 출처 | `measured_tensile / measured_compression / estimated_from_HV / missing` |
| **— 추출 메타 —** | | | | |
| `extraction_confidence` | category | O | 측정값 추출 신뢰도 | `HIGH` |
| `data_source_type` | category | O | 출처 | `table / figure / text / supplementary` |
| `figure_digitized_flag` | integer | O | 그래프 디지타이즈 여부 | `0` |
| `property_evidence_span` | string | O | 근거 문장/위치 | |

### 9.3 Tabor 관계식 (수정)

v1의 `YS ≈ HV / 3`은 단위 무시한 표기였다. 정확한 변환:

```
HV는 kgf/mm² 단위.
HV (MPa) = HV (kgf/mm²) × 9.807
YS (MPa) ≈ HV (MPa) / 3 = HV (kgf/mm²) × 3.27
```

다만 이 관계식은 다음 가정 하에서만 유효:

- 가공경화된 상태(어닐링재는 계수 다름)
- 균질한 단상 조직
- 결정립 크기 효과 무시

따라서 `YS_estimated_from_HV_MPa`는 보조 정보로만 쓰고, 모델 학습 target에는 `YS_source_type = measured_*`인 행만 사용하는 것을 권장한다.

### 9.4 인장 vs 압축 분리 — 재료공학적 이유

같은 BCC RHEA라도:
- **압축 YS > 인장 YS** (전형적으로 5–15% 차이)
- 압축은 균열 전파 억제로 항상 시험 가능, 인장은 취성 시 파단으로 YS 미정 가능
- 모델 학습 시 두 모드를 섞으면 노이즈 폭증

→ 학습 시 `test_mode == "tensile"` 필터 또는 `test_mode`를 categorical 피처로 입력.

---

## 10. 그룹 F — ML 운영 라벨 (테이블: `property_measurements` 일부)

### 10.1 컬럼 정의

| 컬럼명 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| `is_BCC_single` | integer | O | BCC 분율 > 90이면 1 |
| `is_BCC_single_label_source` | category | O | `experimental / descriptor_rule / manual_review` |
| `is_target_met` | integer | O | YS>1000 ∧ EL>30 ∧ BCC>90 |
| `bcc_phase_label` | category | O | `BCC_single / BCC_plus_minor / multiphase / amorphous` |
| `data_split` | category | O | `train / val / test` (조성 클러스터 기반) |
| `composition_cluster_id` | integer | O | 조성 유사도 클러스터 (HDBSCAN/KMeans) |
| `experiment_status` | category | O | `literature / predicted / fabricated / verified` |
| `active_learning_flag` | integer | O | BO 다음 실험 후보 여부 |
| `uncertainty_score` | float | 권장 | 모델 예측 불확실도 |
| `acquisition_score` | float | 선택 | EI 또는 UCB 점수 |
| `is_outlier_flag` | integer | 권장 | descriptor 또는 물성 이상치 여부 |
| `outlier_reason` | string | 선택 | 이상치 사유 |
| `dataset_version_tag` | string | O | 데이터셋 스냅샷 버전 |
| `model_version_tag` | string | O | 예측 생성 모델 버전 |

### 10.2 자동 라벨 생성 기준

#### `is_BCC_single`

1. `BCC_fraction_pct`가 측정값으로 존재 → `> 90`이면 1, 아니면 0. label_source = `experimental`.
2. `phase_structure` 문자열이 `"BCC single-phase"` 또는 동등 표현이면 1. label_source = `experimental`.
3. 위 두 정보 모두 없으면 descriptor 필터(VEC < 6.87, 0 ≤ δ ≤ 8.5, Ω ≥ 1.1, −22 ≤ ΔHmix ≤ 7) 통과 시 1. label_source = `descriptor_rule`.

#### `is_target_met`

```
YS_source_type ∈ {measured_tensile, measured_compression}  AND
test_mode == "tensile"  AND
test_temp_C ≤ 100  AND  (RT 기준 평가)
YS_MPa > 1000  AND
elongation_pct > 30  AND
BCC_fraction_pct > 90 (또는 is_BCC_single == 1)
```

> v1은 시험 모드와 온도를 고려하지 않아, 압축 YS가 높은 샘플이 잘못 양성으로 라벨링될 위험이 있었다. v2는 인장·RT 조건으로 한정.

#### `data_split` — 조성 클러스터 기반

1. 모든 합금의 조성 벡터(10원소 at%)에 대해 HDBSCAN 또는 KMeans 클러스터링.
2. 동일 클러스터 내 합금은 모두 같은 split에 배치.
3. 동일 `paper_id` 내 합금은 가능한 한 같은 split (저자 편향 방지).
4. 클러스터 간 비율 train:val:test = 70:15:15.

---

## 11. 권장 최종 분석 테이블 (Wide JOIN)

학습/추론 시 다음과 같이 JOIN해 단일 평면 테이블 생성:

```sql
SELECT
  p.*,
  a.*,
  s.*,
  m.*
FROM property_measurements m
JOIN processed_samples s ON m.sample_id = s.sample_id
JOIN alloys a            ON s.alloy_id = a.alloy_id
JOIN papers p            ON a.paper_id = p.paper_id;
```

`row_id = measurement_id`가 모델 학습 단위가 된다.

---

## 12. AI 추출용 출력 JSON 템플릿 (정규화 구조)

논문 1편 처리 시 AI는 아래 구조를 따른다. 한 논문에 여러 합금/공정/시험이 있으면 배열로 반환.

```json
{
  "paper": {
    "paper_id": "P001",
    "source_ref": "Wang et al., Acta Mater. 2023",
    "doi": "10.1016/j.actamat.2023.01.001",
    "title": "...",
    "journal": "Acta Materialia",
    "pub_year": 2023,
    "pdf_path": "papers/P001.pdf",
    "pdf_hash_md5": "a3f2...",
    "has_supplementary": 1,
    "extraction_model_version": "claude-sonnet-4-5_2025-09-01",
    "extraction_timestamp": "2026-04-26T10:00:00Z",
    "extraction_confidence": "HIGH",
    "data_source_type": "mixed",
    "evidence_span": "...",
    "manual_review_status": "pending"
  },
  "alloys": [
    {
      "alloy_id": "P001_A1",
      "composition_raw": "Ti36V14Nb22Hf22Zr1Al5",
      "composition_basis": "at%",
      "Ti_at": 36, "Zr_at": 1, "Hf_at": 22, "Nb_at": 22, "Ta_at": 0,
      "V_at": 14, "Mo_at": 0, "W_at": 0, "Cr_at": 0, "Al_at": 5,
      "other_elements_json": null,
      "n_elements": 6,
      "composition_sum_at": 100,
      "composition_valid_flag": 1,
      "composition_normalized_flag": 0,
      "composition_source": "abstract",
      "wt_to_at_atomic_mass_version": null,
      "composition_note": null,

      "samples": [
        {
          "sample_id": "P001_A1_S1",
          "melting_route": "vacuum_arc_melting",
          "remelt_times": 10,
          "melting_atmosphere": "Ti-gettered_Ar",
          "raw_material_purity_min_wt_pct": 99.95,
          "as_cast_flag": 0,
          "homog_temp_C": 1200,
          "homog_time_h": 24,
          "homog_atmosphere": "Ar",
          "deform_type": "cold_rolling",
          "deform_temp_C": 25,
          "reduction_pct": 80,
          "pass_count": null,
          "anneal_temp_C": 1000,
          "anneal_time_value": 5,
          "anneal_time_unit": "min",
          "anneal_atmosphere": "Ar",
          "cooling_method": "WQ",
          "cooling_rate_K_per_s": null,
          "process_steps_json": "[{\"order\":1,\"type\":\"arc_melting\",...}]",
          "n_process_steps": 5,
          "specimen_geometry": "dog_bone",
          "specimen_thickness_mm": 1.5,
          "gauge_length_mm": 10,
          "O_content_wt_ppm": null,
          "N_content_wt_ppm": null,
          "C_content_wt_ppm": null,
          "interstitial_method": null,
          "processing_skipped_flag": 0,
          "process_evidence_span": "The alloy was arc-melted and cold rolled to 80% reduction.",

          "measurements": [
            {
              "measurement_id": "P001_A1_S1_M1",
              "test_mode": "tensile",
              "test_temp_C": 25,
              "test_atmosphere": "air",
              "strain_rate_per_s": 1e-3,
              "n_specimens": 3,
              "phase_structure": "BCC single-phase",
              "BCC_fraction_pct": 100,
              "phase_quantification_method": "Rietveld",
              "secondary_phase": "none",
              "secondary_phase_fraction_pct": 0,
              "lattice_param_a_A": 3.245,
              "ordering_present": "none",
              "phase_id_method": "XRD",
              "grain_size_um": 63.18,
              "grain_size_method": "EBSD",
              "grain_size_type": "mean",
              "recrystallization_pct": null,
              "texture_index": null,
              "dislocation_density_m2": null,
              "precipitate_size_nm": null,
              "precipitate_fraction_pct": null,
              "YS_MPa": 953,
              "YS_offset_method": "0.2pct",
              "UTS_MPa": 1100,
              "elongation_pct": 42,
              "uniform_elong_pct": null,
              "reduction_of_area_pct": null,
              "n_WH": 0.23,
              "K_WH_MPa": null,
              "YS_MPa_std": null,
              "YS_MPa_min": null,
              "YS_MPa_max": null,
              "elongation_pct_std": null,
              "hardness_HV": null,
              "hardness_load_kgf": null,
              "KIC_MPa_m05": null,
              "charpy_J": null,
              "fracture_mode": "ductile",
              "YS_estimated_from_HV_MPa": null,
              "YS_source_type": "measured_tensile",
              "extraction_confidence": "HIGH",
              "data_source_type": "table",
              "figure_digitized_flag": 0,
              "property_evidence_span": "Table 2 reports YS = 953 MPa, EL = 42%."
            }
          ]
        }
      ]
    }
  ]
}
```

---

## 13. AI 판단용 핵심 체크리스트 (확장)

### 13.1 조성 검증
- [ ] `composition_raw`가 원문 그대로 저장되었는가?
- [ ] 모든 대상 원소 컬럼이 존재하는가?
- [ ] 미포함 원소가 `0`으로 입력되었는가?
- [ ] 조성 합계가 99.8–100.2 at% 범위에 있는가?
- [ ] wt% 변환 시 사용한 원자량 테이블 버전이 기록되었는가?
- [ ] 대상 외 원소(B, Si 등)는 `other_elements_json`에 분리되었는가?

### 13.2 Descriptor 검증
- [ ] 자체 계산값과 원문 값이 분리되어 저장되었는가?
- [ ] `descriptor_table_version`과 `descriptor_calc_script_version`이 기록되었는가?
- [ ] ΔHmix가 binary pair 합산식으로 계산되었는가? (Σcᵢ·Hᵢ가 아님)
- [ ] Ω 분모는 절댓값을 사용했는가?
- [ ] VEC 정의(Guo/Wang)가 명시되었는가?

### 13.3 공정 검증
- [ ] 다단계 공정이 `process_steps_json`에 보존되었는가?
- [ ] 시간 단위(s/min/h)가 명시 컬럼에 기록되었는가?
- [ ] As-cast 상태와 정보 미기재가 구분되었는가?
- [ ] 분위기(Ar/vacuum)가 기록되었는가?
- [ ] 산소 함량이 보고된 경우 추출되었는가?

### 13.4 물성 검증
- [ ] `test_mode`로 인장/압축/마이크로필라가 구분되었는가?
- [ ] `test_temp_C`별로 별도 measurement 행이 생성되었는가?
- [ ] YS 단위가 MPa이고 offset 기준이 명시되었는가?
- [ ] BCC 분율의 정량법이 기록되었는가?
- [ ] 결정립 크기 측정법이 기록되었는가?
- [ ] 그래프 디지타이즈 여부가 플래그되었는가?
- [ ] HV 기반 추정값과 실제 측정값이 분리되었는가?

### 13.5 ML 운영 검증
- [ ] `is_BCC_single`의 라벨 출처가 기록되었는가?
- [ ] `is_target_met`이 인장·RT 조건으로 한정되었는가?
- [ ] `data_split`이 조성 클러스터 기반인가?
- [ ] 같은 paper의 합금이 같은 split에 들어갔는가?
- [ ] `dataset_version_tag`와 `model_version_tag`가 기록되었는가?

---

## 14. 운영 시 주의사항

1. **단위 사고 방지**: 시간(s/min/h), 온도(°C/K), 농도(at%/wt%) 혼재가 가장 흔한 오류. 컬럼명에 단위를 항상 포함하고, 값과 단위를 쌍으로 저장한 다음 정규화 컬럼을 별도 생성한다.
2. **descriptor 재현성**: 원소 기준값 테이블(`descriptor_table_version`)과 Miedema 행렬을 데이터셋에 함께 배포한다. 이게 없으면 재계산이 불가능해 모델 비교가 어긋난다.
3. **인장 vs 압축**: target 학습 시 반드시 `test_mode == "tensile"` 필터. 압축 데이터는 별도 모델로 학습하거나 categorical 피처로 활용.
4. **고온 데이터 분리**: RT 학습 모델과 고온 학습 모델을 분리하거나, `test_temp_C`를 피처로 입력해 단일 모델이 온도 의존성을 학습하도록 한다.
5. **산소 함량 대리값**: 보고되지 않은 경우 NaN 그대로 두고, 모델은 `O_reported_flag` 같은 보조 피처로 결측 자체를 정보로 활용.
6. **저자/그룹 편향**: 동일 연구실의 다수 논문이 train으로 쏠리면 test 성능이 과대평가된다. `corresponding_author` 또는 `journal`로 추가 split 확인.
7. **음성 데이터(실패 사례)**: `is_target_met = 0`인 데이터도 학습 가치가 크다. 폐기하지 말고 negative example로 활용.
8. **이상치 자동 탐지**: descriptor 임계값을 크게 벗어난 샘플(예: VEC > 8, Ω < 0.5)은 `is_outlier_flag`로 표시하고 학습 시 제외 또는 별도 처리.
9. **버전 동기화**: `descriptor_table_version`, `descriptor_calc_script_version`, `dataset_version_tag`, `model_version_tag`를 묶어 실험 추적을 한다.

---

## 15. 최소 필수 컬럼 세트 (학습 가능 최소 단위)

```text
# papers
paper_id, source_ref, doi, pdf_hash_md5, extraction_confidence, evidence_span

# alloys
alloy_id, paper_id, composition_raw, composition_basis,
Ti_at, Zr_at, Hf_at, Nb_at, Ta_at, V_at, Mo_at, W_at, Cr_at, Al_at,
n_elements, composition_sum_at, composition_valid_flag,
VEC, delta_pct, dH_mix_kJ, dS_mix_J, Omega, delta_chi,
descriptor_table_version

# processed_samples
sample_id, alloy_id, melting_route, anneal_temp_C, anneal_time_value, anneal_time_unit,
as_cast_flag, process_steps_json

# property_measurements
measurement_id, sample_id,
test_mode, test_temp_C, strain_rate_per_s,
phase_structure, BCC_fraction_pct, secondary_phase,
YS_MPa, YS_source_type, elongation_pct,
extraction_confidence, property_evidence_span,
is_BCC_single, is_target_met, bcc_phase_label,
data_split, experiment_status, dataset_version_tag
```

---

## 16. 파일 및 버전 관리

권장 파일 구성:

```text
schemas/
  bcc_hea_ai_collection_schema_v2.md
  element_property_table_v1.0.csv
  miedema_matrix_v1.0.csv
data/
  papers/
  raw_extracted/        # AI 추출 직후 JSON
  validated/            # 검수 통과
  versions/
    dataset_v1.parquet
    dataset_v2.parquet
scripts/
  descriptor_calc_v1.2.py
  validation_v1.0.py
```

버전 관리 규칙:

| 버전 | 변경 기준 |
|---|---|
| `v1` | 초기 단일 테이블 스키마 |
| `v2` | 다중 테이블 정규화, 시험 모드/온도 분리, descriptor 기준값 명시, 다단계 공정 흡수, 미세조직·시험편·interstitial 추가 |
| `v3` (예정) | 원소군 또는 target 변경 시 |
| `v4` (예정) | descriptor 계산식 또는 기준 물성값 테이블 변경 시 |

Descriptor 기준 테이블이 변경되는 경우 단순 문서 수정이 아니라 데이터셋 재계산 버전으로 관리한다.

---

## 부록 A — v1 → v2 변경 요약

| 영역 | v1 | v2 |
|---|---|---|
| 테이블 구조 | 단일 평면 테이블 | papers / alloys / processed_samples / property_measurements 정규화 |
| 시험 모드 | 구분 없음 | `test_mode` (tensile/compression/...) 필수 |
| 시험 온도 | 그룹 D (공정) | 그룹 E (측정 단위, 온도별 별도 행) |
| 변형속도 | 없음 | `strain_rate_per_s` 권장 |
| 다단계 공정 | 단일 anneal 컬럼 | `process_steps_json` + 구조화 컬럼 병행 |
| 시간 단위 | `_min` 고정 | `(value, unit)` 쌍 + 정규화 파생 컬럼 |
| 어닐링 분위기 | 없음 | `anneal_atmosphere` |
| 냉각속도 | 없음 | `cooling_rate_K_per_s` |
| Interstitial 분석 | 없음 | O/N/C ppm + 분석법 |
| 시편 정보 | 없음 | `specimen_geometry`, `specimen_thickness_mm` |
| 결정립 측정법 | 없음 | `grain_size_method`, `grain_size_type` |
| BCC 분율 정량법 | 없음 | `phase_quantification_method` |
| 격자상수 | 없음 | `lattice_param_a_A` |
| Ordering | 없음 | `ordering_present` (B2 등) |
| 가공경화/인성 | 없음 | `K_WH_MPa`, `KIC_MPa_m05`, `charpy_J` |
| 통계 산포 | 없음 | YS/elongation의 std·min·max |
| Tabor 식 | `YS ≈ HV/3` (단위 누락) | `YS ≈ HV(kgf/mm²) × 3.27` 명시 |
| Descriptor 기준값 | 외부 참조 | 스키마 내 테이블 + 버전 |
| ΔHmix 계산 | 단순 합산 (잘못 가능) | Miedema binary pair 합산 명시 |
| VEC 정의 | 미명시 | Guo/Wang 정의 컬럼 |
| `data_split` 기준 | 조성 클러스터 (개념) | 클러스터링 방법 + paper-level 동일 split 정책 |
| `is_target_met` | YS·EL·BCC 단순 | 인장·RT 한정 + measured 출처 한정 |
| 결측 종류 | 단일 NaN | not_reported / not_measured / processing_skipped 구분 |
| 이상치 처리 | 없음 | `is_outlier_flag` |
| 추출 추적 | extraction_confidence만 | + 모델 버전, timestamp, manual_review_status |
