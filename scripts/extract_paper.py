"""
extract_paper.py v5
====================
PDF 라이브러리 기반 전처리 + Claude API 멀티모달 추출 + 자동 보완(patch)을 한 번에 수행.

변경사항 (v4 → v5):
  [핵심] 물성 추출 품질 대폭 개선
  - system prompt에 필드명 직접 열거 (Ti_at, YS_MPa 등) → 피쳐명 불일치 원천 차단
  - JSON 구조 예시를 system prompt에 포함 → LLM이 올바른 구조를 바로 참조
  - 물성 추출 우선순위 명시 (1순위 조성 → 2순위 YS/연신율 → ...)
  - property_values 중첩 구조 금지 예시 추가
  - 없는 값 처리 규칙 명시: 없으면 null, 필드 생략 금지, 미포함 원소 = 0
  - build_extraction_prompt에 체크리스트 직접 포함
  [구조] v2 스키마 기준으로 통일
  - SCHEMA_PATH → v2 스키마 파일
  - find_missing_fields: processed_samples → samples, property_measurements → measurements
  - apply_patch: 동일 구조 변경
  - find_missing_fields: 조성 합계 0이면 원소 필드 전체 패치 트리거
  - find_missing_fields: 핵심 물성 키(YS_MPa 등) 자체 누락도 패치 대상
  - PATCH_SYSTEM_PROMPT: v2 필드명 기준 예시로 교체
  - build_patch_prompt: measurements_summary 포함해 물성 현황 LLM에 전달

지원 형식:
  - .pdf    : pdfplumber + PyMuPDF 전처리 → Claude API
  - .csv    : 표 데이터를 스키마 JSON으로 변환
  - .xlsx/.xls : Excel 시트를 JSON으로 변환
  - .json   : 이미 JSON인 경우 검증만
  - .txt/.md: 텍스트를 Claude가 파싱해 JSON으로 변환

사용법:
    python scripts/extract_paper.py papers/inbox/wang2023.pdf P001
    python scripts/extract_paper.py papers/inbox/data.csv
    python scripts/extract_paper.py --batch
    python scripts/extract_paper.py --patch-only P001   # 재추출 없이 보완만
    python scripts/extract_paper.py --patch-only --all  # 전체 JSON 재보완
    python scripts/extract_paper.py papers/inbox/wang2023.pdf --skip-patch
"""

import anthropic
import argparse
import base64
import hashlib
import json
import logging
import re
import shutil
import sys
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

import fitz  # PyMuPDF
import pandas as pd
import pdfplumber
from dotenv import load_dotenv

# ─────────────────────────────────────────────────────────────
# 경로 설정
# ─────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schemas" / "bcc_hea_ai_collection_schema_v2.md"
INBOX_DIR = ROOT / "papers" / "filtered" / "hea"
PROCESSED_DIR = ROOT / "papers" / "processed"
EXTRACTED_DIR = ROOT / "data" / "extracted"
LOG_DIR = ROOT / "logs"

for _d in (EXTRACTED_DIR, PROCESSED_DIR, LOG_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────────────────────
# 로깅
# ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "extraction.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("extract")

# ─────────────────────────────────────────────────────────────
# Anthropic 클라이언트
# ─────────────────────────────────────────────────────────────
load_dotenv(ROOT / ".env")
MODEL_NAME = "claude-sonnet-4-5"

# ─────────────────────────────────────────────────────────────
# PDF 처리 설정
# ─────────────────────────────────────────────────────────────
TEXT_DENSITY_THRESHOLD = 100   # 이 값 미만 페이지는 이미지도 함께 전송
RASTER_DPI = 150               # 래스터화 해상도 (높을수록 선명, 토큰 증가)
MAX_TABLE_CHARS = 5000         # 표 텍스트 최대 길이
# 토큰 추정 상한 — 초과 시 이미지 제거 후 텍스트만 재시도
# claude-sonnet-4-5: 200k 윈도우. system(~8k) + 응답(8k) 제외하여 여유 확보
TOKEN_LIMIT_FULL      = 140_000  # 이미지 포함 전체 전송 허용 상한
TOKEN_LIMIT_TEXT_ONLY = 140_000  # 텍스트만 전송 시 상한 (실질적으로 항상 통과)

# ─────────────────────────────────────────────────────────────
# 패치 대상 필드 정의 (v2 스키마 기준)
# ─────────────────────────────────────────────────────────────
# alloy 레벨에서 하나라도 원소값이 0이면 패치 트리거
REQUIRED_ALLOY_FIELDS = ["Ti_at", "Zr_at", "Hf_at", "V_at", "Nb_at",
                          "Ta_at", "Cr_at", "Mo_at", "W_at", "Al_at"]
# sample 레벨 선택적 보완
REQUIRED_SAMPLE_FIELDS = ["reinforcement_info", "strengthening_contributions"]
# measurement 레벨 필수
REQUIRED_MEASUREMENT_FIELDS = ["test_equipment"]
# measurement에서 반드시 있어야 할 핵심 물성 (null이어도 키는 존재해야 함)
REQUIRED_MEAS_PROPERTY_FIELDS = [
    "YS_MPa", "UTS_MPa", "elongation_pct", "hardness_HV",
    "BCC_fraction_pct", "phase_structure", "test_temp_C",
    "test_mode", "YS_source_type", "extraction_confidence",
]


# ═══════════════════════════════════════════════════════════════
# SECTION 1 : 프롬프트
# ═══════════════════════════════════════════════════════════════

# 스키마에서 추출할 핵심 규칙 섹션 슬라이스 인덱스
# (스키마 MD의 섹션 5 "금지 패턴"과 섹션 4 "test_mode 허용값"을 우선 포함)
_SCHEMA_RULES_MARKER = "## 5. 자주 발생하는 오류 패턴"
_SCHEMA_TESTMODE_MARKER = "### test_mode 허용값"


def _extract_schema_parts(schema_text: str) -> tuple[str, str, str]:
    """
    스키마 MD를 세 파트로 분리:
      rules_part  : 섹션 5 (금지 패턴) — 항상 전문 포함
      enums_part  : test_mode 허용값 표 — 항상 전문 포함
      body_part   : 나머지 (섹션 1~4) — 최대 3000자
    """
    rules_part = ""
    enums_part = ""

    if _SCHEMA_RULES_MARKER in schema_text:
        rules_part = schema_text[schema_text.index(_SCHEMA_RULES_MARKER):]
    if _SCHEMA_TESTMODE_MARKER in schema_text:
        idx = schema_text.index(_SCHEMA_TESTMODE_MARKER)
        # test_mode 표 끝까지 (다음 ### 전까지)
        end = schema_text.find("\n### ", idx + 1)
        enums_part = schema_text[idx: end if end > 0 else idx + 800]

    body_part = schema_text[:3000]
    return body_part, enums_part, rules_part


def _build_system_prompt(schema_text: str) -> str:
    """스키마를 포함한 extraction system prompt 생성."""
    _body, enums, rules = _extract_schema_parts(schema_text)
    return f"""당신은 재료공학 논문 데이터 추출 전문가입니다.
BCC 고엔트로피 합금(HEA) 논문에서 아래 규칙에 따라 JSON을 추출합니다.

=== 절대 규칙 ===
1. 응답은 유효한 JSON만 (마크다운 펜스 없이)
2. 없는 값은 null — 필드 자체를 생략하지 말 것
3. 미포함 원소는 반드시 0 (null 금지)
4. 조성은 항상 at%로 변환 (molar ratio이면 at%로 환산 후 기재)
5. 시험 온도별·시험 모드별로 measurements를 반드시 분리
6. 이미지·그래프에서 읽은 값도 기재 (extraction_confidence: "MED")

=== 조성 필드 — alloy 레벨, 반드시 이 키명 사용 ===
Ti_at, Zr_at, Hf_at, V_at, Nb_at, Ta_at, Cr_at, Mo_at, W_at, Al_at
  → 미포함 원소: 0   /   단위: at%   /   합계 ≈ 100

=== Descriptor 필드 — alloy 레벨 ===
VEC, delta_pct, dH_mix_kJ, dS_mix_J, Tm_mix_K, density_calc_gcm3
  → 논문에 보고된 값만 기재, 없으면 null (계산 금지)

=== 물성 필드 — measurement 레벨, 반드시 이 키명 사용 ===
YS_MPa              항복강도 (MPa) — 표·그래프 모두 추출
UTS_MPa             인장강도 (MPa)
elongation_pct      연신율 (%)
hardness_HV         비커스 경도 (HV)
elastic_modulus_GPa 탄성계수 (GPa)
BCC_fraction_pct    BCC 부피분율 (%)
phase_structure     상 구조 문자열 (예: "BCC", "BCC+B2")

금지: property_values 중첩 / mechanical_properties 중첩 / 임의 키명
  ✗ 금지: {{"property_values": {{"yield_strength_MPa": 953}}}}
  ✓ 허용: {{"YS_MPa": 953, "elongation_pct": 42}}

=== 시험 조건 필드 — measurement 레벨 ===
test_mode       "tensile" | "compression" | "hardness_only" |
                "nanoindentation" | "micropillar_compression" | "bending"
test_temp_C     시험 온도(°C). 실온=25. 고온은 각 온도별 별도 행.
YS_source_type  "measured_tensile" | "measured_compression" |
                "hardness_converted" | "nanoindentation" | "unknown"
strain_rate_s   변형속도 (s⁻¹)
extraction_confidence  "HIGH"(표) | "MED"(그래프) | "LOW"(추정)

=== JSON 구조 ===
{{
  "paper": {{ "paper_id": "...", "source_ref": "doi 또는 저자-연도" }},
  "alloys": [
    {{
      "alloy_id": "P001_A001",
      "Ti_at": 25.0, "Zr_at": 25.0, "Nb_at": 25.0, "Mo_at": 25.0,
      "Hf_at": 0, "V_at": 0, "Ta_at": 0, "Cr_at": 0, "W_at": 0, "Al_at": 0,
      "n_elements": 4,
      "VEC": null, "delta_pct": null, "dH_mix_kJ": null,
      "phase_structure": "BCC", "BCC_fraction_pct": 100,
      "samples": [
        {{
          "sample_id": "P001_A001_S001",
          "process_route": "arc_melted_annealed",
          "anneal_temp_C": 1000, "anneal_time_h": 1,
          "measurements": [
            {{
              "measurement_id": "P001_A001_S001_M001",
              "test_mode": "tensile",
              "YS_source_type": "measured_tensile",
              "test_temp_C": 25,
              "strain_rate_s": 1e-3,
              "YS_MPa": 953,
              "UTS_MPa": 1100,
              "elongation_pct": 42,
              "hardness_HV": null,
              "BCC_fraction_pct": 100,
              "phase_structure": "BCC",
              "extraction_confidence": "HIGH",
              "evidence_span": "Table 2"
            }}
          ]
        }}
      ]
    }}
  ]
}}

=== 추출 우선순위 ===
1순위: 조성 (Ti_at 등) — 없으면 alloy 전체가 쓸모없음
2순위: YS_MPa, elongation_pct — ML 핵심 타겟
3순위: BCC_fraction_pct, phase_structure — 라벨링용
4순위: 공정 조건 (process_route, anneal_temp_C 등)
5순위: 나머지 물성 (hardness_HV, UTS_MPa 등)

{enums}

{rules}"""


EXTRACTION_SYSTEM_PROMPT = ""  # 런타임에 _build_system_prompt()로 대체


PATCH_SYSTEM_PROMPT = """당신은 재료공학 논문 데이터 추출 전문가입니다.
기존에 추출된 JSON에 누락된 구조화 필드를 보완하는 역할을 합니다.

규칙:
1. 응답은 유효한 JSON 패치만 (펜스 없이)
2. 이미 존재하는 필드는 건드리지 않음 — 누락 필드만 추가
3. 데이터가 전혀 없는 필드는 패치에서 생략 (null로 채우지 말 것)
4. 조성은 at% 단위 (Ti_at, Nb_at 등), 미포함 원소는 0
5. 물성 키명: YS_MPa / UTS_MPa / elongation_pct / hardness_HV (중첩 금지)

반환 형식:
{
  "alloy_patches": [
    {
      "alloy_id": "P001_A001",
      "Ti_at": 25.0, "Nb_at": 25.0, "Mo_at": 25.0, "W_at": 25.0,
      "Zr_at": 0, "Hf_at": 0, "V_at": 0, "Ta_at": 0, "Cr_at": 0, "Al_at": 0,
      "n_elements": 4
    }
  ],
  "sample_patches": [
    {
      "sample_id": "P001_A001_S001",
      "reinforcement_info": {},
      "strengthening_contributions": {}
    }
  ],
  "measurement_patches": [
    {
      "measurement_id": "P001_A001_S001_M001",
      "test_equipment": "Instron 5569",
      "YS_MPa": 953,
      "elongation_pct": 42
    }
  ]
}"""


def build_extraction_prompt(schema_text: str, paper_id: str, page_info: str) -> str:
    return f"""논문 전체를 읽고 모든 BCC HEA 데이터를 빠짐없이 추출하세요.
응답은 JSON만 (펜스 없이).

paper_id = {paper_id}
{page_info}

=== 추출 체크리스트 — 제출 전 반드시 확인 ===
[ ] 모든 합금의 Ti_at ~ Al_at 조성이 기재되었는가? (없는 원소 = 0)
[ ] YS_MPa가 표 또는 그래프에 있으면 추출했는가?
[ ] elongation_pct가 보고된 경우 추출했는가?
[ ] 고온 시험이 있으면 온도별로 별도 measurement를 만들었는가?
[ ] BCC_fraction_pct 또는 phase_structure가 있으면 기재했는가?
[ ] 공정 조건(process_route, anneal_temp_C 등)을 기재했는가?
[ ] 없는 값은 null로, 필드 자체를 생략하지 않았는가?
[ ] property_values 중첩 구조를 쓰지 않았는가?"""


def build_table_prompt(file_ext: str, file_name: str, paper_id: str) -> str:
    return f"""다음 {file_ext.upper()} 표를 스키마 JSON으로 변환하세요.
파일: {file_name}, paper_id: {paper_id}
표의 각 행이 하나의 측정 데이터입니다.
조성, 물성, 공정, 시험 조건을 추출해 JSON으로 변환하세요.
없는 값은 null, 미포함 원소는 0.
응답은 JSON만 (펜스 없이)."""


def build_patch_prompt(data: dict, missing: dict) -> str:
    notes = data.get("paper", {}).get("notes", "")
    alloy_summary = [
        {
            "alloy_id": a.get("alloy_id"),
            "alloy_designation": a.get("alloy_designation"),
            "composition": {
                el: a.get(f"{el}_at")
                for el in ["Ti","Zr","Hf","V","Nb","Ta","Cr","Mo","W","Al"]
                if a.get(f"{el}_at") is not None
            },
            "samples": [
                {
                    "sample_id": s.get("sample_id"),
                    "measurement_ids": [
                        m.get("measurement_id") for m in s.get("measurements", [])
                    ],
                    "measurements_summary": [
                        {
                            "id": m.get("measurement_id"),
                            "test_mode": m.get("test_mode"),
                            "test_temp_C": m.get("test_temp_C"),
                            "YS_MPa": m.get("YS_MPa"),
                            "elongation_pct": m.get("elongation_pct"),
                            "hardness_HV": m.get("hardness_HV"),
                        }
                        for m in s.get("measurements", [])
                    ],
                }
                for s in a.get("samples", [])
            ],
        }
        for a in data.get("alloys", [])
    ]
    return f"""기존 추출 JSON에 누락된 필드를 보완해 JSON 패치로 반환하세요.

=== 누락 필드 목록 ===
{json.dumps(missing, ensure_ascii=False, indent=2)}

=== 논문 notes (원문) ===
{notes}

=== alloy 구조 요약 (현재 상태) ===
{json.dumps(alloy_summary, ensure_ascii=False, indent=2)}

주의사항:
- 조성(Ti_at 등)이 0이면 논문에서 실제 값을 찾아 채울 것
- 물성(YS_MPa 등)이 null이면 논문 텍스트·표·그래프에서 재탐색할 것
- 데이터가 정말 없는 필드만 패치에서 생략 (불확실하면 MED 신뢰도로 기재)
- 응답은 JSON만 (펜스 없이)"""


# ═══════════════════════════════════════════════════════════════
# SECTION 2 : 공통 유틸리티
# ═══════════════════════════════════════════════════════════════

def md5_of_file(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def strip_json_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def call_llm(messages: list, system: str, max_tokens: int = 8000, max_retries: int = 2) -> dict:
    """Claude API 호출 + JSON 파싱. 실패 시 재시도."""
    client = anthropic.Anthropic()
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            kwargs = dict(model=MODEL_NAME, max_tokens=max_tokens, messages=messages)
            if system:
                kwargs["system"] = system
            response = client.messages.create(**kwargs)
            raw = "".join(b.text for b in response.content if hasattr(b, "text"))
            return json.loads(strip_json_fences(raw)), response.model
        except json.JSONDecodeError as e:
            last_err = e
            log.warning(f"JSON 파싱 실패 (시도 {attempt}): {e}")
            time.sleep(2)
        except Exception as e:
            last_err = e
            log.warning(f"API 오류 (시도 {attempt}): {e}")
            time.sleep(3)
    raise RuntimeError(f"LLM 호출 최종 실패: {last_err}")


# ═══════════════════════════════════════════════════════════════
# SECTION 3 : PDF 전처리
# ═══════════════════════════════════════════════════════════════

def format_table_as_text(table: list) -> str:
    if not table:
        return ""
    return "\n".join(
        " | ".join(str(c).strip() if c is not None else "" for c in row)
        for row in table
    )


def rasterize_page(pdf_path: Path, page_num: int, dpi: int = RASTER_DPI) -> str:
    doc = fitz.open(str(pdf_path))
    pix = doc[page_num].get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), colorspace=fitz.csRGB)
    b64 = base64.standard_b64encode(pix.tobytes("png")).decode()
    doc.close()
    return b64


def extract_pdf_content(pdf_path: Path) -> list:
    """
    PDF를 페이지 단위로 분석.
    - 텍스트: pdfplumber extract_text() (표 구조 추출은 신뢰도 낮아 생략)
    - 이미지: 모든 페이지 무조건 래스터화
      → 조건부 래스터화(v4)는 텍스트 전용 페이지(참고문헌, 방법론 등)를
        LLM에 이미지로 전달하지 않아 표 구조·수치 오독 가능성이 있었음
      → 전 페이지 래스터화 시 추가 토큰은 ~1800 tokens/page로 미미함
    """
    pages = []

    # 1) pdfplumber: 텍스트 추출 (표 감지는 이 논문 포맷에서 신뢰도 낮아 비활성화)
    with pdfplumber.open(str(pdf_path)) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            pages.append({
                "page_num": i,
                "text": text,
                "tables": [],       # 표는 래스터 이미지로 시각 전달
                "image_b64": None,
            })

    # 2) PyMuPDF: 모든 페이지 래스터화 (조건 없음)
    doc = fitz.open(str(pdf_path))
    for i in range(len(doc)):
        try:
            pages[i]["image_b64"] = rasterize_page(pdf_path, i)
        except Exception as e:
            log.warning(f"  페이지 {i+1} 래스터화 실패: {e}")
    doc.close()
    return pages


# chunk_pages 제거 (v5: 단일 호출 방식)


def build_message_content(pages: list) -> list:
    """
    페이지별 content 블록 생성.
    텍스트 블록(본문) → 이미지 블록(전 페이지) 순으로 인터리빙.
    표는 pdfplumber 구조 추출 대신 래스터 이미지로 시각 전달 (구조 오인식 방지).
    """
    content = []
    for page in pages:
        pn = page["page_num"] + 1
        # 텍스트 블록: 본문 흐름 텍스트 (LLM의 위치 파악용)
        if page["text"].strip():
            content.append({"type": "text",
                            "text": f"[페이지 {pn}]\n{page['text']}"})
        # 이미지 블록: 표·그래프·수식 시각 정보 전달
        if page["image_b64"]:
            content.append({"type": "image", "source": {
                "type": "base64", "media_type": "image/png",
                "data": page["image_b64"]}})
    return content


# ═══════════════════════════════════════════════════════════════
# SECTION 4 : 누락 필드 감지 & 패치 적용
# ═══════════════════════════════════════════════════════════════

def find_missing_fields(data: dict) -> dict:
    """
    누락 필드 감지.
    - alloy: 조성 합계가 0이면 모든 원소 필드를 누락으로 표시
    - measurement: 핵심 물성 키 자체가 없거나 null인 경우 보완 대상
    """
    missing = {}
    TARGET_ELEMENTS = ["Ti","Zr","Hf","V","Nb","Ta","Cr","Mo","W","Al"]

    for alloy in data.get("alloys", []):
        aid = alloy.get("alloy_id", "?")

        # 조성 합계가 0이면 전체 원소 필드 누락으로 판단
        total = sum(alloy.get(f"{el}_at") or 0 for el in TARGET_ELEMENTS)
        if total == 0:
            missing[aid] = [f"{el}_at" for el in TARGET_ELEMENTS]

        for sample in alloy.get("samples", []):
            sid = sample.get("sample_id", "?")
            lack = [f for f in REQUIRED_SAMPLE_FIELDS if f not in sample]
            if lack:
                missing[sid] = lack

            for meas in sample.get("measurements", []):
                mid = meas.get("measurement_id", "?")
                lack = []
                # test_equipment 누락
                if "test_equipment" not in meas:
                    lack.append("test_equipment")
                # 핵심 물성 필드가 아예 없는 경우 (null은 허용, 키 자체 없으면 보완)
                for field in REQUIRED_MEAS_PROPERTY_FIELDS:
                    if field not in meas:
                        lack.append(field)
                if lack:
                    missing[mid] = lack
    return missing


def apply_patch(data: dict, patch: dict) -> tuple:
    updated = deepcopy(data)
    count = 0

    alloy_patches  = {p["alloy_id"]: p       for p in patch.get("alloy_patches", [])}
    sample_patches = {p["sample_id"]: p      for p in patch.get("sample_patches", [])}
    meas_patches   = {p["measurement_id"]: p for p in patch.get("measurement_patches", [])}

    for alloy in updated.get("alloys", []):
        aid = alloy.get("alloy_id")
        if aid in alloy_patches:
            for k, v in alloy_patches[aid].items():
                if k != "alloy_id" and k not in alloy:
                    alloy[k] = v
                    count += 1
                    log.info(f"  + {aid}.{k}")
        for sample in alloy.get("samples", []):
            sid = sample.get("sample_id")
            if sid in sample_patches:
                for k, v in sample_patches[sid].items():
                    if k != "sample_id" and k not in sample:
                        sample[k] = v
                        count += 1
                        log.info(f"  + {sid}.{k}")
            for meas in sample.get("measurements", []):
                mid = meas.get("measurement_id")
                if mid in meas_patches:
                    for k, v in meas_patches[mid].items():
                        if k != "measurement_id" and k not in meas:
                            meas[k] = v
                            count += 1
                            log.info(f"  + {mid}.{k}")

    return updated, count


def auto_patch(data: dict, paper_id: str) -> dict:
    """추출 결과에서 누락 필드를 감지하고 LLM으로 자동 보완."""
    missing = find_missing_fields(data)
    if not missing:
        log.info(f"[{paper_id}] 누락 필드 없음 — 패치 생략")
        return data

    total = sum(len(v) for v in missing.values())
    log.info(f"[{paper_id}] 누락 필드 {total}개 감지 → LLM 패치 요청")
    for obj_id, fields in missing.items():
        log.info(f"  {obj_id}: {fields}")

    patch, _ = call_llm(
    messages=[{"role": "user", "content": build_patch_prompt(data, missing)}],
    system=PATCH_SYSTEM_PROMPT,
    max_tokens=4000,
    )
    patched, n = apply_patch(data, patch)
    log.info(f"[{paper_id}] 패치 완료: {n}개 필드 추가")
    return patched


# ═══════════════════════════════════════════════════════════════
# SECTION 5 : 파일 타입별 추출
# ═══════════════════════════════════════════════════════════════

def _estimate_tokens(content: list) -> int:
    """content 블록의 토큰 수 추정 (text: chars/4, image: ~1800)."""
    total = 0
    for block in content:
        if block.get("type") == "text":
            total += len(block.get("text", "")) // 4
        elif block.get("type") == "image":
            total += 1800
    return total


def extract_pdf(pdf_path: Path, paper_id: str, schema_text: str) -> dict:
    """
    PDF 전체를 단일 API 호출로 추출.
    토큰 추정값이 상한 초과 시 이미지 제거 후 텍스트만 재시도.
    """
    log.info(f"[{paper_id}] PDF 전처리: {pdf_path.name}")
    pages = extract_pdf_content(pdf_path)
    total = len(pages)
    img_pages = sum(1 for p in pages if p["image_b64"])
    log.info(f"[{paper_id}] {total}페이지 | 이미지 포함: {img_pages}페이지")

    system_prompt = _build_system_prompt(schema_text) if schema_text else (
        "BCC HEA 논문에서 조성·공정·물성 데이터를 JSON으로 추출하세요. 응답은 JSON만."
    )

    # ── 1차 시도: 이미지 포함 전체 전송 ──────────────────────────
    content = build_message_content(pages)
    content.append({"type": "text", "text": build_extraction_prompt(
        schema_text, paper_id, f"전체 {total}페이지 논문")})

    est_tokens = _estimate_tokens(content)
    log.info(f"[{paper_id}] 추정 토큰: ~{est_tokens:,} / 상한 {TOKEN_LIMIT_FULL:,}")

    if est_tokens <= TOKEN_LIMIT_FULL:
        try:
            data, model_version = call_llm(messages=[{"role": "user", "content": content}],
                system=system_prompt)
            log.info(f"[{paper_id}] 단일 호출(이미지 포함) 성공: alloys {len(data.get('alloys', []))}개")
            return data, model_version
        except Exception as e:
            log.warning(f"[{paper_id}] 이미지 포함 호출 실패: {e} → 텍스트 전용 재시도")

    # ── 2차 시도: 이미지 제거, 텍스트만 전송 ─────────────────────
    log.info(f"[{paper_id}] 텍스트 전용 모드로 재시도 (이미지 {img_pages}페이지 제외)")
    pages_text_only = [{**p, "image_b64": None} for p in pages]
    content_text = build_message_content(pages_text_only)
    content_text.append({"type": "text", "text": build_extraction_prompt(
        schema_text, paper_id, f"전체 {total}페이지 (이미지 제외)")})

    est_tokens_text = _estimate_tokens(content_text)
    log.info(f"[{paper_id}] 텍스트 전용 추정 토큰: ~{est_tokens_text:,}")

    data, model_version = call_llm(messages=[{"role": "user", "content": content_text}],
                system=system_prompt)
    log.info(f"[{paper_id}] 텍스트 전용 호출 성공: alloys {len(data.get('alloys', []))}개")
    return data, model_version


def extract_csv_or_excel(file_path: Path, paper_id: str) -> dict:
    df = pd.read_csv(file_path) if file_path.suffix.lower() == ".csv" else pd.read_excel(file_path)
    prompt = (f"{build_table_prompt(file_path.suffix, file_path.name, paper_id)}"
              f"\n\n=== 표 데이터 ===\n{df.to_string()}\n\nJSON으로 변환하세요. (펜스 없이)")
    log.info(f"[{paper_id}] 표 파싱 중...")
    return call_llm(messages=[{"role": "user", "content": prompt}], system="")


def extract_text_file(file_path: Path, paper_id: str) -> dict:
    text = file_path.read_text(encoding="utf-8")[:5000]
    prompt = (f"다음 텍스트에서 BCC HEA 데이터를 스키마 JSON으로 변환하세요.\n"
              f"paper_id = {paper_id}\n\n내용:\n---\n{text}\n---\n\nJSON 응답 (펜스 없이).")
    log.info(f"[{paper_id}] 텍스트 파싱 중...")
    return call_llm(messages=[{"role": "user", "content": prompt}], system="", max_tokens=4000)


def extract_json_file(file_path: Path, paper_id: str) -> dict:
    data = json.loads(file_path.read_text(encoding="utf-8"))
    log.info(f"[{paper_id}] JSON 검증 통과")
    return data


def extract_one(file_path: Path, paper_id: str, schema_text: str, skip_patch: bool = False) -> dict:
    """파일 타입 라우팅 → 추출 → 자동 패치 → 메타 주입."""
    ext = file_path.suffix.lower()
    if ext == ".pdf":
        data, model_version = extract_pdf(file_path, paper_id, schema_text)
    elif ext in {".csv", ".xlsx", ".xls"}:
            data, model_version = extract_csv_or_excel(file_path, paper_id)
    elif ext in {".txt", ".md"}:
        data, model_version = extract_text_file(file_path, paper_id)
    elif ext == ".json":
        data = extract_json_file(file_path, paper_id)
        model_version = None
    else:
        raise ValueError(f"지원 안 함: {ext}")

    # ── 자동 패치 (추출 직후) ──────────────────────────────────
    if not skip_patch:
        data = auto_patch(data, paper_id)

    # ── 메타 주입 ─────────────────────────────────────────────
    data.setdefault("paper", {})
    data["paper"]["paper_id"] = paper_id
    data["paper"]["source_file_type"] = ext
    data["paper"]["pdf_hash_md5"] = md5_of_file(file_path)
    data["paper"]["extraction_model_version"] = model_version or "unknown"
    data["paper"]["extraction_timestamp"] = datetime.now(timezone.utc).isoformat()
    data["paper"].setdefault("manual_review_status", "pending")

    return data


# ═══════════════════════════════════════════════════════════════
# SECTION 6 : 저장 / ID 관리
# ═══════════════════════════════════════════════════════════════

def save_extraction(data: dict, paper_id: str) -> Path:
    out_path = EXTRACTED_DIR / f"{paper_id}.json"
    out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return out_path


def next_paper_id() -> str:
    existing = [p for p in EXTRACTED_DIR.glob("P*.json") if ".bak_" not in p.name]
    if not existing:
        return "P001"
    last_num = max(
        int(m.group(1))
        for p in existing
        if (m := re.search(r"P(\d+)", p.stem))
    )
    return f"P{last_num + 1:03d}"


# ═══════════════════════════════════════════════════════════════
# SECTION 7 : 처리 진입점
# ═══════════════════════════════════════════════════════════════

def load_doi_map() -> dict:
    """collection_metadata.json → {paperId: {doi, title, authors, year}}"""
    meta_path = LOG_DIR / "collection_metadata.json"
    if not meta_path.exists():
        log.warning("collection_metadata.json 없음 — DOI 자동 주입 skipped")
        return {}
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    return {item["paperId"]: item for item in meta.get("papers", []) if item.get("doi")}

def append_extracted_metadata(paper_id: str, source_paper_id: str, data: dict, meta: dict) -> None:
    """추출 성공한 논문의 메타데이터를 data/metadata.json에 누적 저장."""
    meta_path =  ROOT / "data" / "metadata.json" 

    existing = []
    if meta_path.exists():
        try:
            existing = json.loads(meta_path.read_text(encoding="utf-8")).get("papers", [])
        except Exception:
            existing = []

    # 중복 paper_id 방지
    existing_ids = {p.get("paper_id") for p in existing}
    if paper_id in existing_ids:
        log.info(f"[{paper_id}] metadata.json에 이미 존재 — 스킵")
        return

    paper_data = data.get("paper", {})
    record = {
        "paper_id":        paper_id,
        "source_paper_id": source_paper_id,
        "doi":             meta.get("doi") or paper_data.get("source_ref", "").replace("doi:", "") or None,
        "title":           meta.get("title")   or paper_data.get("title"),
        "authors":         meta.get("authors") or paper_data.get("authors"),
        "year":            meta.get("year")    or paper_data.get("year"),
        "extracted_at":    datetime.now(timezone.utc).isoformat(),
    }

    existing.append(record)
    meta_path.write_text(
        json.dumps({"papers": existing}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    log.info(f"[{paper_id}] metadata.json 기록 완료")

def process_single(file_path, paper_id=None, schema_text="", skip_patch=False):
    if paper_id is None:
        paper_id = next_paper_id()

    # 파일명(stem) == paperId → DOI 조회
    doi_map = load_doi_map()
    source_paper_id = file_path.stem  # "10_1016_j_jallcom_2022_166473"
    meta = doi_map.get(source_paper_id, {})

    log.info(f"=== {file_path.name} → {paper_id} ===")
    data = extract_one(file_path, paper_id, schema_text, skip_patch=skip_patch)

    # 메타 덮어쓰기 (LLM 추출값보다 우선)
    if meta:
        data["paper"]["source_paper_id"] = source_paper_id
        data["paper"]["source_ref"]      = f"doi:{meta['doi']}"
        data["paper"]["title"]           = meta.get("title")
        data["paper"]["authors"]         = meta.get("authors")
        data["paper"]["year"]            = meta.get("year")
        log.info(f"[{paper_id}] DOI 주입: {meta['doi']}")
    else:
        log.warning(f"[{paper_id}] {source_paper_id} — metadata 없음, LLM 추출값 유지")

    out_path = save_extraction(data, paper_id)
    log.info(f"✅ {paper_id}: {out_path}")
    shutil.move(str(file_path), str(PROCESSED_DIR / f"{paper_id}_{file_path.name}"))
    append_extracted_metadata(paper_id, source_paper_id, data, meta)  # ← 추가
    return out_path
    


def process_batch(schema_text: str = "", skip_patch: bool = False) -> None:
    exts = {"*.pdf", "*.csv", "*.xlsx", "*.xls", "*.json", "*.txt", "*.md"}
    files = sorted({f for ext in exts for f in INBOX_DIR.glob(ext)})
    if not files:
        log.warning(f"inbox 비어있음: {INBOX_DIR}")
        return
    log.info(f"일괄 처리: {len(files)}개 파일")
    ok = ng = 0
    for f in files:
        try:
            process_single(f, schema_text=schema_text, skip_patch=skip_patch)
            ok += 1
        except Exception as e:
            log.error(f"실패 {f.name}: {e}")
            ng += 1
    log.info(f"=== 완료: {ok} 성공, {ng} 실패 ===")


def patch_only(paper_id: str) -> None:
    """이미 추출된 JSON에 패치만 적용 (PDF 재호출 없음)."""
    json_path = EXTRACTED_DIR / f"{paper_id}.json"
    if not json_path.exists():
        log.error(f"{paper_id}.json 없음: {json_path}")
        return
    data = json.loads(json_path.read_text(encoding="utf-8"))
    patched = auto_patch(data, paper_id)
    bak = json_path.with_suffix(f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    bak.write_text(json_path.read_text(encoding="utf-8"), encoding="utf-8")
    json_path.write_text(json.dumps(patched, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info(f"✅ [{paper_id}] 패치 저장 완료 (백업: {bak.name})")


def patch_all() -> None:
    files = [f for f in sorted(EXTRACTED_DIR.glob("P*.json")) if ".bak_" not in f.name]
    if not files:
        log.warning("extracted/ 비어있음")
        return
    for f in files:
        try:
            patch_only(f.stem)
        except Exception as e:
            log.error(f"패치 실패 {f.stem}: {e}")


# ═══════════════════════════════════════════════════════════════
# SECTION 8 : CLI
# ═══════════════════════════════════════════════════════════════

def main() -> None:
    schema_text = SCHEMA_PATH.read_text(encoding="utf-8") if SCHEMA_PATH.exists() else ""

    parser = argparse.ArgumentParser(
        description="BCC HEA 논문 데이터 추출 + 자동 보완 (v4)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""예시:
  python extract_paper.py papers/inbox/wang2023.pdf P001   # 추출 + 패치
  python extract_paper.py papers/inbox/wang2023.pdf --skip-patch  # 추출만
  python extract_paper.py --batch                          # inbox 전체
  python extract_paper.py --patch-only P001               # 기존 JSON 재보완
  python extract_paper.py --patch-only --all              # 전체 JSON 재보완
        """,
    )
    parser.add_argument("file_path", nargs="?", help="파일 경로 (또는 --patch-only 시 paper_id)")
    parser.add_argument("paper_id", nargs="?", help="paper_id (생략 시 자동 부여)")
    parser.add_argument("--batch", action="store_true", help="inbox 전체 일괄 처리")
    parser.add_argument("--skip-patch", action="store_true", dest="skip_patch",
                        help="자동 패치 단계 생략 (빠른 테스트용)")
    parser.add_argument("--patch-only", action="store_true", dest="patch_only",
                        help="추출 없이 기존 JSON에 패치만 실행")
    parser.add_argument("--all", action="store_true",
                        help="--patch-only와 함께: extracted/ 전체 재보완")
    args = parser.parse_args()

    if args.patch_only:
        if args.all:
            patch_all()
        else:
            pid = args.file_path or args.paper_id
            if pid:
                patch_only(pid)
            else:
                parser.print_help()
    elif args.batch:
        process_batch(schema_text, skip_patch=args.skip_patch)
    elif args.file_path:
        process_single(Path(args.file_path), args.paper_id, schema_text, skip_patch=args.skip_patch)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()