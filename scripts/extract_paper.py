"""
extract_paper.py v2
====================
다양한 파일 형식을 지원하는 데이터 추출 스크립트.

지원 형식:
  - .pdf    : Claude의 멀티모달 추출 (논문 전체 텍스트/표/그림)
  - .csv    : 표 데이터를 스키마 JSON으로 변환
  - .xlsx/.xls : Excel 시트를 JSON으로 변환
  - .json   : 이미 JSON인 경우 검증만
  - .txt/.md: 텍스트를 Claude가 파싱해 JSON으로 변환

사용법:
    python scripts/extract_paper.py papers/inbox/wang2023.pdf P001
    python scripts/extract_paper.py papers/inbox/data.csv P002
    python scripts/extract_paper.py papers/inbox/supplement.xlsx P003
    python scripts/extract_paper.py --batch  # inbox 전체
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
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

# ─────────────────────────────────────────────────────────────
# 경로 설정
# ─────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schemas" / "bcc_hea_ai_collection_schema_v2.md"
INBOX_DIR = ROOT / "papers" / "inbox"
PROCESSED_DIR = ROOT / "papers" / "processed"
EXTRACTED_DIR = ROOT / "data" / "extracted"
LOG_DIR = ROOT / "logs"

EXTRACTED_DIR.mkdir(parents=True, exist_ok=True)
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

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
EXTRACTION_MODEL_VERSION = f"{MODEL_NAME}_{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"

# ─────────────────────────────────────────────────────────────
# 프롬프트
# ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT_PDF = """당신은 재료공학 논문 데이터 추출 전문가입니다.
첨부된 PDF에서 BCC 고엔트로피 합금(HEA)의 조성·공정·물성 데이터를 JSON으로 추출합니다.

규칙:
1. 응답은 유효한 JSON만 (펜스 없이)
2. 원소가 없으면 0, 정보 없으면 null
3. 인장과 압축을 test_mode로 구분
4. 같은 합금의 다온도 시험은 별도 measurements 행으로 분리"""


def build_user_prompt_pdf(schema_text: str, paper_id: str) -> str:
    return f"""v2 스키마에 따라 PDF에서 데이터를 추출해주세요.
응답은 JSON만 (펜스 없이).

=== 스키마 (축약) ===
{schema_text[:2000]}...

paper_id = {paper_id}
alloys 배열에 모든 조성을 넣으세요.
"""


def build_user_prompt_table(file_ext: str, file_name: str, paper_id: str) -> str:
    return f"""다음 {file_ext.upper()} 표를 스키마 JSON으로 변환하세요.

파일: {file_name}, paper_id: {paper_id}

표의 각 행이 하나의 측정 데이터입니다.
조성, 물성, 공정, 시험 조건을 추출해 JSON으로 변환하세요.

없는 값은 null, 미포함 원소는 0.
응답은 JSON만 (펜스 없이)."""


# ─────────────────────────────────────────────────────────────
# 핵심 함수
# ─────────────────────────────────────────────────────────────
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


def extract_pdf(pdf_path: Path, paper_id: str, schema_text: str, max_retries: int = 2) -> dict:
    """PDF를 Claude API로 추출."""
    pdf_b64 = base64.standard_b64encode(pdf_path.read_bytes()).decode()
    client = anthropic.Anthropic()
    user_prompt = build_user_prompt_pdf(schema_text, paper_id)

    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            log.info(f"[{paper_id}] PDF 추출 시도 {attempt}/{max_retries}")
            response = client.messages.create(
                model=MODEL_NAME,
                max_tokens=8000,
                system=SYSTEM_PROMPT_PDF,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": pdf_b64,
                            },
                        },
                        {"type": "text", "text": user_prompt},
                    ],
                }],
            )
            raw_text = "".join(b.text for b in response.content if hasattr(b, "text"))
            cleaned = strip_json_fences(raw_text)
            data = json.loads(cleaned)
            return data
        except json.JSONDecodeError as e:
            last_err = e
            log.warning(f"[{paper_id}] JSON 파싱 실패, 재시도...")
            time.sleep(2)
        except Exception as e:
            last_err = e
            log.warning(f"[{paper_id}] LLM 오류, 재시도...")
            time.sleep(3)

    raise RuntimeError(f"[{paper_id}] PDF 추출 실패: {last_err}")


def extract_csv_or_excel(file_path: Path, paper_id: str) -> dict:
    """CSV/Excel 표를 Claude로 파싱."""
    try:
        if file_path.suffix.lower() == ".csv":
            df = pd.read_csv(file_path, encoding="utf-8")
        else:
            df = pd.read_excel(file_path)
    except Exception as e:
        log.error(f"[{paper_id}] 파일 읽기 실패: {e}")
        raise

    table_text = df.to_string()
    client = anthropic.Anthropic()
    user_prompt = build_user_prompt_table(file_path.suffix, file_path.name, paper_id)
    prompt = f"""{user_prompt}

=== 표 데이터 ===
{table_text}

JSON으로 변환하세요. (펜스 없이)"""

    log.info(f"[{paper_id}] 표 파싱 중...")
    try:
        response = client.messages.create(
            model=MODEL_NAME,
            max_tokens=8000,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = "".join(b.text for b in response.content if hasattr(b, "text"))
        cleaned = strip_json_fences(raw_text)
        data = json.loads(cleaned)
        return data
    except Exception as e:
        log.error(f"[{paper_id}] 표 변환 실패: {e}")
        raise


def extract_text(file_path: Path, paper_id: str) -> dict:
    """TXT/MD 파일을 Claude로 파싱."""
    text_content = file_path.read_text(encoding="utf-8")[:5000]
    client = anthropic.Anthropic()

    prompt = f"""다음 텍스트에서 BCC HEA 데이터를 스키마 JSON으로 변환하세요.
paper_id = {paper_id}

내용:
---
{text_content}
---

JSON 응답 (펜스 없이)."""

    log.info(f"[{paper_id}] 텍스트 파싱 중...")
    try:
        response = client.messages.create(
            model=MODEL_NAME,
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = "".join(b.text for b in response.content if hasattr(b, "text"))
        cleaned = strip_json_fences(raw_text)
        data = json.loads(cleaned)
        return data
    except Exception as e:
        log.error(f"[{paper_id}] 텍스트 파싱 실패: {e}")
        raise


def extract_json(file_path: Path, paper_id: str) -> dict:
    """JSON 파일 검증."""
    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
        log.info(f"[{paper_id}] JSON 검증 통과")
        return data
    except Exception as e:
        log.error(f"[{paper_id}] JSON 검증 실패: {e}")
        raise


def extract_one(file_path: Path, paper_id: str, schema_text: str) -> dict:
    """파일 타입에 따라 추출."""
    file_ext = file_path.suffix.lower()

    if file_ext == ".pdf":
        data = extract_pdf(file_path, paper_id, schema_text)
    elif file_ext == ".csv":
        data = extract_csv_or_excel(file_path, paper_id)
    elif file_ext in {".xlsx", ".xls"}:
        data = extract_csv_or_excel(file_path, paper_id)
    elif file_ext in {".txt", ".md"}:
        data = extract_text(file_path, paper_id)
    elif file_ext == ".json":
        data = extract_json(file_path, paper_id)
    else:
        raise ValueError(f"지원 안 함: {file_ext}")

    # 메타 주입
    data.setdefault("paper", {})
    data["paper"]["paper_id"] = paper_id
    data["paper"]["source_file_type"] = file_ext
    data["paper"]["pdf_hash_md5"] = md5_of_file(file_path)
    data["paper"]["extraction_model_version"] = EXTRACTION_MODEL_VERSION
    data["paper"]["extraction_timestamp"] = datetime.now(timezone.utc).isoformat()
    data["paper"].setdefault("manual_review_status", "pending")

    return data


def save_extraction(data: dict, paper_id: str) -> Path:
    out_path = EXTRACTED_DIR / f"{paper_id}.json"
    out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return out_path


def next_paper_id() -> str:
    existing = sorted(EXTRACTED_DIR.glob("P*.json"))
    if not existing:
        return "P001"
    last_num = max(
        int(re.search(r"P(\d+)", p.stem).group(1))
        for p in existing
        if re.search(r"P(\d+)", p.stem)
    )
    return f"P{last_num + 1:03d}"


def process_single(file_path: Path, paper_id: str | None = None, schema_text: str = "") -> Path:
    if paper_id is None:
        paper_id = next_paper_id()
    log.info(f"=== {file_path.name} ({file_path.suffix}) → {paper_id} ===")
    data = extract_one(file_path, paper_id, schema_text)
    out_path = save_extraction(data, paper_id)
    log.info(f"✅ {paper_id}: {out_path}")

    dest = PROCESSED_DIR / f"{paper_id}_{file_path.name}"
    shutil.move(str(file_path), str(dest))
    log.info(f"   파일 이동: {dest}")
    return out_path


def process_batch(schema_text: str = ""):
    exts = {"*.pdf", "*.csv", "*.xlsx", "*.xls", "*.json", "*.txt", "*.md"}
    files = []
    for ext in exts:
        files.extend(INBOX_DIR.glob(ext))
    files = sorted(set(files))

    if not files:
        log.warning(f"inbox 비어있음: {INBOX_DIR}")
        return
    log.info(f"일괄 처리: {len(files)}개 파일")
    ok, ng = 0, 0
    for f in files:
        try:
            process_single(f, schema_text=schema_text)
            ok += 1
        except Exception as e:
            log.error(f"실패 {f.name}: {e}")
            ng += 1
    log.info(f"=== 완료: {ok} 성공, {ng} 실패 ===")


def main():
    schema_text = SCHEMA_PATH.read_text(encoding="utf-8") if SCHEMA_PATH.exists() else ""

    parser = argparse.ArgumentParser(description="PDF/CSV/Excel/JSON/TXT 파일 추출")
    parser.add_argument("file_path", nargs="?", help="파일 경로")
    parser.add_argument("paper_id", nargs="?", help="paper_id (예: P001)")
    parser.add_argument("--batch", action="store_true", help="inbox 전체")
    args = parser.parse_args()

    if args.batch:
        process_batch(schema_text)
    elif args.file_path:
        file = Path(args.file_path)
        process_single(file, args.paper_id, schema_text)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
