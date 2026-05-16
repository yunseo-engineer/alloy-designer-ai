"""
merge_manual_papers.py
─────────────────────────────────────────────────────────────────
수동 다운로드된 논문 PDF의 메타정보를 텍스트 파싱으로 추출하여
기존 collection_metadata.json에 중복 없이 병합하는 스크립트.

중복 허용 x 
파싱 오류 파일의 경우 수동으로 정보 추가 필요
─────────────────────────────────────────────────────────────────
"""

import re
import json
from pathlib import Path
from datetime import datetime

try:
    from pypdf import PdfReader
except ImportError:
    print("[오류] pypdf 미설치. 'pip install pypdf' 실행 후 다시 시도하세요.")
    exit(1)

# ── 경로 설정 ──────────────────────────────────────────────────
MANUAL_PDF_DIR = Path("./papers/inbox")
METADATA_PATH  = Path("./logs/collection_metadata.json")


# ══════════════════════════════════════════════════════════════
#  1. PDF 텍스트 / 내장 메타 추출
# ══════════════════════════════════════════════════════════════

def extract_text(pdf_path: Path, max_pages: int = 3) -> str:
    """PDF 앞 max_pages 페이지의 텍스트를 반환."""
    try:
        reader = PdfReader(str(pdf_path))
        pages  = reader.pages[:max_pages]
        return "\n".join(p.extract_text() or "" for p in pages)
    except Exception as e:
        print(f"  [텍스트 추출 오류] {e}")
        return ""


def extract_builtin_meta(pdf_path: Path) -> dict:
    """PDF 내장 메타데이터(제목·저자)를 반환."""
    try:
        meta = PdfReader(str(pdf_path)).metadata or {}
        return {
            "title":  str(meta.get("/Title",  "") or "").strip(),
            "author": str(meta.get("/Author", "") or "").strip(),
        }
    except Exception:
        return {"title": "", "author": ""}


# ══════════════════════════════════════════════════════════════
#  2. 정규식 파싱
# ══════════════════════════════════════════════════════════════

DOI_RE = re.compile(
    r"\b(10\.\d{4,9}/[^\s\"\'<>(){}\[\]\n,;]+)",
    re.IGNORECASE,
)
YEAR_RE = re.compile(r"\b(20[0-2][0-9])\b")

# 저자 줄 패턴: "Kim, J., Lee, S." 또는 "John Smith, Jane Doe" 형태
AUTHOR_LINE_RE = re.compile(
    r"^([A-Z][a-záéíóú\-]+(?:\s+[A-Z][\w\-\.]+){1,4}"
    r"(?:\s*,\s*[A-Z][a-záéíóú\-]+(?:\s+[A-Z][\w\-\.]+){1,4})*"
    r"(?:\s+and\s+[A-Z][a-záéíóú\-]+(?:\s+[A-Z][\w\-\.]+){1,4})?)\s*$"
)


def parse_doi(text: str) -> str:
    m = DOI_RE.search(text)
    return m.group(1).rstrip(".,;)") if m else ""


def parse_year(text: str) -> int | None:
    years = YEAR_RE.findall(text[:3000])
    return int(years[0]) if years else None


def parse_title(text: str, builtin_title: str) -> str:
    """
    제목 추출 우선순위:
    1) PDF 내장 메타 제목
    2) 텍스트 첫 번째 유효한 긴 줄
    """
    if builtin_title and len(builtin_title) > 10:
        return builtin_title

    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for line in lines[:30]:
        if not (20 <= len(line) <= 250):
            continue
        if line.isupper():
            continue
        if "doi" in line.lower() or "http" in line.lower():
            continue
        if re.match(r"^[\d\s\.\-]+$", line):
            continue
        return line
    return lines[0] if lines else ""


def parse_authors(text: str, builtin_author: str) -> str:
    """
    저자 추출 우선순위:
    1) PDF 내장 메타 저자
    2) 텍스트 앞부분 저자 패턴 줄
    """
    if builtin_author and len(builtin_author) > 3:
        return builtin_author

    lines = [l.strip() for l in text[:2000].splitlines() if l.strip()]
    for line in lines:
        m = AUTHOR_LINE_RE.match(line)
        if m:
            return m.group(1)
    return ""


# ══════════════════════════════════════════════════════════════
#  3. 레코드 생성
# ══════════════════════════════════════════════════════════════

def make_record(pdf_path: Path) -> dict:
    text    = extract_text(pdf_path)
    builtin = extract_builtin_meta(pdf_path)

    doi     = parse_doi(text)
    title   = parse_title(text, builtin["title"])
    authors = parse_authors(text, builtin["author"])
    year    = parse_year(text)

    # paperId:파일명 기반
    paper_id = pdf_path.stem

    return {
        "paperId":    paper_id,
        "title":      title,
        "authors":    authors,
        "year":       year,
        "doi":        doi,
        "pdf_url":    ""
    }


# ══════════════════════════════════════════════════════════════
#  4. 중복 검사
# ══════════════════════════════════════════════════════════════

def build_index(papers: list) -> set:
    idx = set()
    for p in papers:
        if p.get("paperId"):
            idx.add(p["paperId"])
        if p.get("doi"):
            idx.add(p["doi"].lower().strip())
        if p.get("title"):
            idx.add(p["title"].lower()[:200])
    return idx


def is_duplicate(record: dict, idx: set) -> bool:
    if record.get("paperId") and record["paperId"] in idx:
        return True
    return False


def index_add(record: dict, idx: set) -> None:
    if record.get("paperId"):
        idx.add(record["paperId"])
    if record.get("doi"):
        idx.add(record["doi"].lower().strip())
    if record.get("title"):
        idx.add(record["title"].lower()[:80])


# ══════════════════════════════════════════════════════════════
#  5. 메인
# ══════════════════════════════════════════════════════════════

def load_metadata() -> dict:
    if METADATA_PATH.exists():
        with open(METADATA_PATH, encoding="utf-8") as f:
            return json.load(f)
    print(f"[정보] {METADATA_PATH} 없음 → 신규 생성.")
    return {
        "timestamp": "",
        "summary":   {"downloaded": 0, "skipped": 0, "failed": 0, "total": 0},
        "papers":    [],
    }


def save_metadata(data: dict) -> None:
    METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    data["timestamp"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(METADATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\n저장 완료: {METADATA_PATH}")


def merge_manual_pdfs() -> None:
    data   = load_metadata()
    papers = data.setdefault("papers", [])
    idx    = build_index(papers)

    if not MANUAL_PDF_DIR.exists():
        print(f"\n폴더 없음: {MANUAL_PDF_DIR.resolve()}")
        return

    pdf_files = sorted(MANUAL_PDF_DIR.glob("*.pdf"))
    print(f"PDF 폴더  : {MANUAL_PDF_DIR.resolve()}")
    print(f"기존 논문 : {len(papers)}개")
    print(f"발견된 PDF: {len(pdf_files)}개")
    print("─" * 60)

    added, skipped, failed = 0, 0, 0

    for pdf_path in pdf_files:
        print(f"\n {pdf_path.name}")
        try:
            record = make_record(pdf_path)
        except Exception as e:
            print(f"파싱 실패: {e}")
            failed += 1
            continue

        print(f"  제목  : {record['title'][:70]}")
        print(f"  저자  : {record['authors'][:60] or '(파싱 실패)'}")
        print(f"  연도  : {record['year'] or '(없음)'}")
        print(f"  DOI   : {record['doi'] or '(없음)'}")

        if is_duplicate(record, idx):
            print("  ⏭  중복 → 건너뜀")
            skipped += 1
            continue

        papers.append(record)
        index_add(record, idx)
        added += 1
        print("  ➕ 추가됨")

    # summary 업데이트
    s = data.setdefault("summary", {})
    s["downloaded"] = s.get("downloaded", 0) + added
    s["skipped"]    = s.get("skipped", 0)    + skipped
    s["failed"]     = s.get("failed", 0)     + failed
    s["total"]      = len(papers)

    save_metadata(data)

    print("\n" + "═" * 60)
    print(f"  추가됨      : {added}개")
    print(f"  중복 건너뜀  : {skipped}개")
    print(f"  실패        : {failed}개")
    print(f"  전체 논문    : {len(papers)}개")
    print("═" * 60)

    # 파싱 불완전 항목 안내
    incomplete = [
        p for p in papers
        if p.get("source") == "manual_pdf"
        and (not p.get("authors") or not p.get("year") or not p.get("doi"))
    ]
    if incomplete:
        print(f"\n[주의] 파싱 불완전 항목 {len(incomplete)}개 — 수동 보완 필요:")
        for p in incomplete:
            missing = [k for k in ("authors", "year", "doi") if not p.get(k)]
            print(f"  - {p['title'][:55]}  누락: {', '.join(missing)}")


if __name__ == "__main__":
    merge_manual_pdfs()
