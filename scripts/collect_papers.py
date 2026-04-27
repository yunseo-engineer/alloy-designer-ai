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
- Semantic Scholar API v1 (무료, 제한 없음)
- 1초당 1 요청 권장 (과부하 방지)
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
REQUEST_TIMEOUT = 10
RATE_LIMIT_DELAY = 1.0  # 초

# 기본 검색 키워드
DEFAULT_KEYWORDS = [
    "BCC high entropy alloy",
    "refractory HEA mechanical properties",
    "TiZrHfNbTa alloy",
    "body-centered cubic single-phase",
    "refractory metals entropy",
    "BCC HEA yield strength elongation",
    "TiNbMoW equiatomic",
    "RHEAs design",
]

# ─────────────────────────────────────────────────────────────
# API 함수
# ─────────────────────────────────────────────────────────────
def search_semantic_scholar(query: str, limit: int = 50) -> list[dict]:
    """Semantic Scholar에서 논문 검색."""
    params = {
        "query": query,
        "limit": min(limit, 1000),
        "fields": "paperId,title,authors,year,externalIds,openAccessPdf,abstract,venue",
        "sort": "relevance",
    }

    log.info(f"검색: {query}")

    try:
        response = requests.get(SEMANTIC_SCHOLAR_API, params=params, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        data = response.json()
        papers = data.get("data", [])
        log.info(f"  → {len(papers)}개 결과")
        return papers
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
        response = requests.get(url, timeout=30, allow_redirects=True)
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
    limit_per_keyword: int = 50,
    year_min: int = 2010,
    dry_run: bool = False,
) -> dict:
    """
    논문 수집.
    
    Args:
        keywords: 검색 키워드
        limit_per_keyword: 키워드당 최대 논문 수
        year_min: 최소 연도
        dry_run: True이면 목록만 보기
    """
    if keywords is None:
        keywords = DEFAULT_KEYWORDS

    all_papers = {}
    results = {"downloaded": 0, "skipped": 0, "failed": 0, "papers": []}

    for i, keyword in enumerate(keywords):
        log.info(f"\n[{i+1}/{len(keywords)}] {keyword}")
        papers = search_semantic_scholar(keyword, limit=limit_per_keyword)

        for paper in papers:
            pid = paper.get("paperId")
            if not pid or pid in all_papers:
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

            # 메타 저장
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
            all_papers[pid] = paper_meta
            results["papers"].append(paper_meta)

            if not dry_run:
                filename = paper_to_filename(paper)
                filepath = INBOX_DIR / filename
                if filepath.exists():
                    log.info(f"  ✓ (기존) {title}")
                    continue
                if download_pdf(pdf_url, filepath):
                    results["downloaded"] += 1
                else:
                    results["failed"] += 1
                time.sleep(RATE_LIMIT_DELAY)

        if i < len(keywords) - 1:
            time.sleep(2)

    return results


def save_metadata(results: dict) -> None:
    """메타데이터 저장."""
    metadata = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "summary": {
            "downloaded": results["downloaded"],
            "skipped": results["skipped"],
            "failed": results["failed"],
            "total": len(results["papers"]),
        },
        "papers": results["papers"],
    }
    path = LOG_DIR / "collection_metadata.json"
    path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info(f"\n메타 저장: {path}")


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
