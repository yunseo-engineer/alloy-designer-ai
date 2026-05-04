"""
collect_papers.py
=================
Semantic Scholar API를 사용해 BCC HEA 관련 논문을 자동 수집한다.

수집 대상:
- 검색 키워드: "high entropy alloy", "refractory HEA", "BCC single-phase" 등
- Open Access만 (PDF 자동 다운로드 가능)
- 내림차순 정렬: 최신 논문 우선

사용법:
    python scripts/collect_papers.py --limit 50

    → papers/inbox/에 최대 50개 논문 다운로드

    python scripts/collect_papers.py --keywords "Ti-Zr-Hf" --limit 20
    → 커스텀 키워드로 검색

    python scripts/collect_papers.py --list
    → 다운로드할 논문 목록만 보기 (실제 다운로드 안 함)

API 정보:
- Semantic Scholar API v1 (무료 사용: 5분당 최대 100건의 요청)
- 요청 당 30초 딜레이 적용 (429 오류 방지)
- DOI 또는 Semantic Scholar ID로 검색 가능
"""

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import Optional

import requests

# ─────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
INBOX_DIR = ROOT / "papers" / "inbox"
LOG_DIR = ROOT / "logs"
COLLECTION_LOG = LOG_DIR / "collection.log"

INBOX_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(COLLECTION_LOG, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("collect")

# ─────────────────────────────────────────────────────────────
# API 설정
# ─────────────────────────────────────────────────────────────
SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1/paper/search"
REQUEST_TIMEOUT = 20
RATE_LIMIT_DELAY =10  # 초

# 기본 검색 키워드
DEFAULT_KEYWORDS = [
    "TiZrHfNbTa alloy",
    "body-centered cubic single-phase",
    "refractory metals entropy",
    "BCC HEA yield strength elongation",
    "TiNbMoW equiatomic",
    "RHEAs design",
    "BCC high entropy alloy",
    "refractory HEA mechanical properties"
]

# ─────────────────────────────────────────────────────────────
# API 함수
# ─────────────────────────────────────────────────────────────
def search_semantic_scholar(query: str, limit: int = 1000) -> list[dict]:
    """Semantic Scholar에서 논문 검색."""
    params = {
        "query": query,
        "limit": min(limit, 2000),
        "fields": "paperId,title,authors,year,externalIds,openAccessPdf,abstract,venue",
        "sort": "relevance",
    }

    log.info(f"검색: {query}")
    time.sleep(RATE_LIMIT_DELAY)

    try:
        response = requests.get(SEMANTIC_SCHOLAR_API, params=params, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        data = response.json()
        papers = data.get("data", [])
        log.info(f"  → {len(papers)}개 결과")
        return papers
    
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 429:          # ← 429 전용 처리
            log.warning("Rate limit 도달. 150초 대기 후 1회 재시도...")
            time.sleep(150)
            try:
                response = requests.get(SEMANTIC_SCHOLAR_API, params=params, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                return response.json().get("data", [])
            except Exception:
                log.error("재시도 실패. 건너뜀.")
                return []
        log.error(f"API 오류: {e}")
        return []
    except requests.exceptions.RequestException as e:
        log.error(f"API 오류: {e}")
        return []


def get_pdf_url(paper: dict) -> Optional[str]:
    """PDF URL 추출."""
    pdf_info = paper.get("openAccessPdf")
    if pdf_info and isinstance(pdf_info, dict):
        return pdf_info.get("url")
    return None


def download_pdf(url: str, filepath: Path) -> bool:
    """PDF 다운로드."""
    try:
        response = requests.get(url, timeout=90, allow_redirects=True)
        response.raise_for_status()
        if response.headers.get("content-type", "").startswith("application/pdf"):
            filepath.write_bytes(response.content)
            size_mb = filepath.stat().st_size / (1024 * 1024)
            log.info(f"  ✅ {filepath.name} ({size_mb:.2f}MB)")
            return True
        return False
    except Exception as e:
        log.error(f"  ❌ {e}")
        return False


def paper_to_filename(paper: dict) -> str:
    """논문을 파일명으로 변환."""
    doi = paper.get("externalIds", {}).get("DOI")
    if doi:
        safe_doi = doi.replace("/", "_").replace(".", "_")
        return f"{safe_doi}.pdf"
    
    paper_id = paper.get("paperId", "unknown")
    title = paper.get("title", "untitled")
    safe_title = "".join(c if c.isalnum() or c in " " else "" for c in title[:40])
    safe_title = safe_title.strip().replace(" ", "_")
    return f"{paper_id}_{safe_title}.pdf"


def collect_papers(
    keywords: list[str] = None,
    limit_per_keyword: int =5000,
    year_min: int = 2010,
    dry_run: bool = False,
) -> dict:
    """
    논문 수집. (중복 수집 x, PDF 다운로드 성공 시에만 메타데이터 저장)

    Args:
        keywords: 검색 키워드
        limit_per_keyword: 키워드당 최대 논문 수
        year_min: 최소 연도
        dry_run: True이면 목록만 보기
    """
    if keywords is None:
        keywords = DEFAULT_KEYWORDS

    # ── 기존 메타데이터 로드 (실행 간 중복 방지) ──────────────────
    metadata_path = LOG_DIR / "collection_metadata.json"
    if metadata_path.exists():
        with open(metadata_path, encoding="utf-8") as f:
            existing = json.load(f)
        existing_ids = {p["paperId"] for p in existing.get("papers", [])}
        log.info(f"기존 수집 논문: {len(existing_ids)}편 (중복 제외 대상)")
    else:
        existing_ids = set()
    # ──────────────────────────────────────────────────────────────

    all_papers = {}  # 현재 실행 내 키워드 간 중복 방지
    results = {"downloaded": 0, "skipped": 0, "failed": 0, "papers": []}

    for i, keyword in enumerate(keywords):
        log.info(f"\n[{i+1}/{len(keywords)}] {keyword}")
        papers = search_semantic_scholar(keyword, limit=limit_per_keyword)

        for paper in papers:
            pid = paper.get("paperId")

            # 현재 실행 내 중복
            if not pid or pid in all_papers:
                continue

            # 이전 실행에서 이미 수집한 논문
            if pid in existing_ids:
                log.info(f"  ✓ (중복) {paper.get('title', '')}")
                continue

            year = paper.get("year")
            if year and year < year_min:
                continue

            title = paper.get("title", "untitled")
            pdf_url = get_pdf_url(paper)

            if not pdf_url:
                log.info(f"  ⊘ {title}")
                results["skipped"] += 1
                continue

            all_papers[pid] = True  # 현재 실행 내 중복 방지용

            authors = paper.get("authors", [])
            author_str = ", ".join(a.get("name", "") for a in authors[:3])
            paper_meta = {
                "paperId": pid,
                "title": title,
                "authors": author_str,
                "year": year,
                "doi": paper.get("externalIds", {}).get("DOI"),
                "pdf_url": pdf_url,
            }

            if not dry_run:
                filename = paper_to_filename(paper)
                filepath = INBOX_DIR / filename

                if filepath.exists():
                    log.info(f"  ✓ (기존 파일) {title}")
                    continue  # PDF 있어도 메타데이터에는 추가 안 함 (existing_ids로 이미 관리)

                if download_pdf(pdf_url, filepath):
                    results["downloaded"] += 1
                    results["papers"].append(paper_meta)  # ← 다운로드 성공 시에만 추가
                else:
                    results["failed"] += 1
                    # 실패 시 메타데이터 추가 안 함

                time.sleep(RATE_LIMIT_DELAY)

    return results


def save_metadata(results: dict) -> None:
    """메타데이터 저장 (기존 데이터와 병합, PDF 다운로드 성공 논문만)."""
    metadata_path = LOG_DIR / "collection_metadata.json"

    # 기존 데이터 로드 후 병합
    if metadata_path.exists():
        with open(metadata_path, encoding="utf-8") as f:
            existing = json.load(f)
        merged_papers = existing.get("papers", []) + results["papers"]
    else:
        merged_papers = results["papers"]

    metadata = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "summary": {
            "downloaded": results["downloaded"],       # 이번 실행 다운로드 수
            "skipped": results["skipped"],             # 이번 실행 Open Access 없음
            "failed": results["failed"],               # 이번 실행 실패 수
            "total": len(merged_papers),               # 누적 전체 수
        },
        "papers": merged_papers,                       # 누적 논문 목록
    }
    metadata_path.write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    log.info(f"\n메타 저장: {metadata_path} (누적 {len(merged_papers)}편)")


def main():
    parser = argparse.ArgumentParser(description="Semantic Scholar로 BCC HEA 논문 수집")
    parser.add_argument("--keywords", nargs="+", help="커스텀 키워드")
    parser.add_argument("--limit", type=int, default=50, help="키워드당 최대 수 (기본: 50)")
    parser.add_argument("--year-min", type=int, default=2010, help="최소 연도 (기본: 2010)")
    parser.add_argument("--list", action="store_true", help="목록만 보기")
    args = parser.parse_args()

    keywords = args.keywords if args.keywords else DEFAULT_KEYWORDS
    dry_run = args.list

    log.info("=" * 70)
    log.info("BCC HEA 논문 자동 수집")
    log.info("=" * 70)

    results = collect_papers(keywords, args.limit, args.year_min, dry_run)

    log.info("\n" + "=" * 70)
    log.info(f"✅ 다운로드: {results['downloaded']}")
    log.info(f"⊘ Open Access 아님: {results['skipped']}")
    log.info(f"❌ 실패: {results['failed']}")
    log.info(f"📊 고유 논문: {len(results['papers'])}")
    log.info("=" * 70)

    if not dry_run:
        save_metadata(results)
        log.info(f"📁 위치: {INBOX_DIR}")

    log.info("\n다음: python scripts/extract_paper.py --batch")


if __name__ == "__main__":
    main()
