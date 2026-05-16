"""
filter_papers_hea.py
====================
API 비용 없이 BCC HEA 논문만 선별하는 필터링 스크립트.

방법:
  1. Heuristic  : 키워드 매칭 (0원, <1초/논문, 정확도 ~70%)
  2. Vision     : 첫 2페이지 이미지 → Claude Vision (0원*, 3초/논문, ~85%)
  3. API verify : Maybe 폴더 재확인 (유료, $0.01/논문, ~95%)

  * Vision은 claude.ai 인터페이스가 아닌 API 사용 시 비용 발생.
    여기서는 Heuristic → Vision 순으로 적용하고,
    --api-verify 플래그 시 Maybe를 Claude API로 재확인.

사용법:
    python scripts/filter_papers_hea.py papers/inbox
    python scripts/filter_papers_hea.py papers/inbox --api-verify
    python scripts/filter_papers_hea.py papers/inbox --method heuristic
"""

import anthropic
import argparse
import base64
import json
import logging
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import fitz  # PyMuPDF
from dotenv import load_dotenv

# ─────────────────────────────────────────────────────────────
# 경로 설정
# ─────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

load_dotenv(ROOT / ".env")

# ─────────────────────────────────────────────────────────────
# 로깅
# ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "filter.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("filter")

MODEL_NAME = "claude-sonnet-4-5-20251022"

# ─────────────────────────────────────────────────────────────
# 키워드 정의
# ─────────────────────────────────────────────────────────────

# 확실한 HEA 키워드
HEA_POSITIVE = [
    "high-entropy alloy", "high entropy alloy",
    "multi-principal element", "multi-principal-element",
    "compositionally complex alloy", "refractory high-entropy",
    "refractory hea", "rhea", "mpea",
]

# BCC 관련
BCC_KEYWORDS = [
    "bcc", "body-centered cubic", "body centered cubic",
    "single-phase bcc", "bcc single phase", "bcc solid solution",
]

# 기계적 물성 키워드
MECH_KEYWORDS = [
    "yield strength", "tensile", "elongation", "ductility",
    "mechanical properties", "compressive strength",
]

# 확실한 REJECT 키워드
REJECT_KEYWORDS = [
    "ti6al4v", "ti-6al-4v", "ti 6al 4v",
    "inconel", "hastelloy", "waspaloy",
    "stainless steel", "maraging steel",
    "ni-based superalloy", "nickel superalloy", "nickel-based superalloy",
    "aluminum alloy", "aa7075", "aa6061",
    "shape memory alloy", "nitinol",
    "superconductiv",  # 초전도 HEA (물성 목적 다름)
    "amorphous", "metallic glass",
    "oxide dispersion", "ods steel",
]

# FCC 전용 (BCC 아님) — HEA여도 BCC 아니면 제외
FCC_ONLY = [
    "fcc single phase", "single-phase fcc", "fcc solid solution",
    "cantor alloy", "crmnfeconi", "crfeconi",
]


# ─────────────────────────────────────────────────────────────
# 텍스트 추출
# ─────────────────────────────────────────────────────────────
def extract_text_first_pages(pdf_path: Path, n_pages: int = 3) -> str:
    """PDF 앞 n페이지 텍스트 추출."""
    try:
        doc = fitz.open(pdf_path)
        pages = min(n_pages, len(doc))
        text = ""
        for i in range(pages):
            text += doc[i].get_text("text")
        doc.close()
        return text.lower()
    except Exception as e:
        log.warning(f"텍스트 추출 실패 ({pdf_path.name}): {e}")
        return ""


def extract_first_pages_as_b64(pdf_path: Path, n_pages: int = 2, dpi: int = 100) -> list[str]:
    """PDF 앞 n페이지를 JPEG base64 리스트로 반환."""
    images = []
    try:
        doc = fitz.open(pdf_path)
        pages = min(n_pages, len(doc))
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        for i in range(pages):
            pix = doc[i].get_pixmap(matrix=mat, colorspace=fitz.csRGB)
            b64 = base64.standard_b64encode(pix.tobytes("jpeg")).decode()
            images.append(b64)
        doc.close()
    except Exception as e:
        log.warning(f"이미지 변환 실패 ({pdf_path.name}): {e}")
    return images


# ─────────────────────────────────────────────────────────────
# 필터링 메서드
# ─────────────────────────────────────────────────────────────
def heuristic_filter(text: str) -> tuple[str, float, str]:
    """
    키워드 기반 필터링.
    returns: (label, confidence, reason)
    label: 'hea' | 'reject' | 'maybe'
    """
    # REJECT 먼저 체크
    for kw in REJECT_KEYWORDS:
        if kw in text:
            return "reject", 0.9, f"REJECT 키워드 발견: '{kw}'"

    # FCC 전용 체크
    for kw in FCC_ONLY:
        if kw in text:
            return "reject", 0.85, f"FCC 전용 키워드: '{kw}'"

    # HEA 점수 계산
    hea_score = sum(1 for kw in HEA_POSITIVE if kw in text)
    bcc_score = sum(1 for kw in BCC_KEYWORDS if kw in text)
    mech_score = sum(1 for kw in MECH_KEYWORDS if kw in text)

    total = hea_score + bcc_score + mech_score

    if hea_score >= 1 and bcc_score >= 1 and mech_score >= 1:
        conf = min(0.5 + total * 0.05, 0.90)
        return "hea", conf, f"HEA={hea_score}, BCC={bcc_score}, Mech={mech_score}"

    if hea_score >= 1 and bcc_score >= 1:
        return "maybe", 0.6, f"HEA+BCC 있으나 기계물성 키워드 없음"

    if hea_score >= 1:
        return "maybe", 0.5, f"HEA 키워드 있으나 BCC 미확인"

    if total == 0:
        return "reject", 0.7, "HEA 관련 키워드 없음"

    return "maybe", 0.4, f"키워드 부족: HEA={hea_score}, BCC={bcc_score}"


def vision_filter(pdf_path: Path) -> tuple[str, float, str]:
    """
    Claude Vision으로 앞 2페이지를 보고 판단.
    API 키 없으면 heuristic으로 폴백.
    """
    images = extract_first_pages_as_b64(pdf_path, n_pages=2)
    if not images:
        log.warning(f"이미지 변환 실패, heuristic으로 폴백: {pdf_path.name}")
        text = extract_text_first_pages(pdf_path)
        return heuristic_filter(text)

    try:
        client = anthropic.Anthropic()
        content = []

        for img_b64 in images:
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/jpeg", "data": img_b64},
            })

        content.append({
            "type": "text",
            "text": """이 논문의 첫 페이지를 보고 아래 질문에 답하세요.

판단 기준:
1. BCC 단상 고엔트로피 합금(HEA) 연구인가?
2. 5종 이상 원소 포함하는가?
3. 항복강도/연신율 등 기계적 물성 데이터가 있는가?

응답은 반드시 아래 JSON 형식만:
{
  "label": "hea" | "reject" | "maybe",
  "confidence": 0.0~1.0,
  "reason": "판단 근거 한 줄"
}

label 기준:
- hea: BCC HEA이고 기계적 물성 있음 (confidence >= 0.8)
- reject: HEA 아님 또는 BCC 아님 (Ti6Al4V, Ni 초합금, FCC HEA 등)
- maybe: 확신 없음""",
        })

        response = client.messages.create(
            model=MODEL_NAME,
            max_tokens=200,
            messages=[{"role": "user", "content": content}],
        )
        raw = response.content[0].text.strip()
        # JSON 파싱
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        result = json.loads(raw)
        return result["label"], float(result["confidence"]), result["reason"]

    except anthropic.RateLimitError:
        log.warning(f"Vision Rate Limit, 60초 대기...")
        time.sleep(60)
        return vision_filter(pdf_path)  # 재시도
    except Exception as e:
        log.warning(f"Vision 실패 ({pdf_path.name}): {e}, heuristic 폴백")
        text = extract_text_first_pages(pdf_path)
        return heuristic_filter(text)


def api_verify(pdf_path: Path) -> tuple[str, float, str]:
    """
    Abstract 텍스트 → Claude API로 정밀 판단.
    Maybe 재확인용.
    """
    text = extract_text_first_pages(pdf_path, n_pages=2)
    abstract_text = text[:3000]

    try:
        client = anthropic.Anthropic()
        prompt = f"""다음은 재료공학 논문의 앞부분입니다.

텍스트:
---
{abstract_text}
---

이 논문이 아래 조건을 모두 만족하는지 판단하세요:
1. 고엔트로피 합금(HEA) 또는 다주원소 합금(MPEA) 연구
2. BCC 단상(single-phase BCC) 구조
3. Ti, Zr, Hf, Nb, Ta, V, Mo, W, Cr, Al 중 4종 이상 포함
4. 항복강도(yield strength) 또는 연신율(elongation) 데이터 존재

반드시 아래 JSON만 반환:
{{
  "label": "hea" | "reject" | "maybe",
  "confidence": 0.0~1.0,
  "reason": "판단 근거"
}}"""

        response = client.messages.create(
            model=MODEL_NAME,
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        result = json.loads(raw)
        return result["label"], float(result["confidence"]), result["reason"]

    except anthropic.RateLimitError:
        log.warning("API verify Rate Limit, 65초 대기...")
        time.sleep(65)
        return api_verify(pdf_path)
    except Exception as e:
        log.warning(f"API verify 실패 ({pdf_path.name}): {e}")
        return "maybe", 0.5, f"API 오류: {e}"


# ─────────────────────────────────────────────────────────────
# 메타데이터 분기 저장
# ─────────────────────────────────────────────────────────────
def split_metadata(filtered_dir: Path, results: list[dict]) -> None:
    """
    logs/collection_metadata.json을 필터링 결과 기준으로 분기 저장.
    → filtered/metadata_hea.json    (추출 파이프라인에서 DOI 조회용)
    → filtered/metadata_maybe.json
    → filtered/metadata_reject.json

    paperId 매핑 규칙:
      파일명 stem(확장자 제거)이 collection_metadata의 paperId와 일치해야 함.
      예: "10_1016_j_jallcom_2022_166473.pdf" → paperId "10_1016_j_jallcom_2022_166473"
    """
    meta_path = LOG_DIR / "collection_metadata.json"
    if not meta_path.exists():
        log.warning("collection_metadata.json 없음 — 메타데이터 분기 스킵")
        return

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    all_papers = meta.get("papers", [])

    # 파일명 stem → label 매핑
    label_map = {r["file"].rsplit(".", 1)[0]: r["label"] for r in results}

    buckets: dict[str, list] = {"hea": [], "maybe": [], "reject": [], "unknown": []}
    for paper in all_papers:
        pid = paper.get("paperId", "")
        label = label_map.get(pid, "unknown")
        buckets[label].append(paper)

    # 각 라벨별로 저장 — 재실행 시 중복 방지를 위해 기존 파일과 병합
    for label, papers in buckets.items():
        out_path = filtered_dir / f"metadata_{label}.json"
        existing = []
        if out_path.exists():
            try:
                existing = json.loads(out_path.read_text(encoding="utf-8")).get("papers", [])
            except Exception:
                existing = []
        existing_ids = {p.get("paperId") for p in existing}
        merged = existing + [p for p in papers if p.get("paperId") not in existing_ids]
        out_path.write_text(
            json.dumps({"papers": merged}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    log.info(
        f"📋 메타데이터 분기 완료 → "
        f"hea:{len(buckets['hea'])}편 / "
        f"maybe:{len(buckets['maybe'])}편 / "
        f"reject:{len(buckets['reject'])}편 / "
        f"unknown:{len(buckets['unknown'])}편"
    )
    if buckets["unknown"]:
        log.warning(
            f"  ⚠️  paperId 매핑 실패 {len(buckets['unknown'])}편 "
            f"(파일명과 paperId가 다를 수 있음)"
        )


# ─────────────────────────────────────────────────────────────
# 메인 필터링 루프
# ─────────────────────────────────────────────────────────────
def filter_papers(inbox_dir: Path, method: str = "vision", api_verify_maybe: bool = False):
    """
    inbox_dir의 PDF를 필터링해서 filtered/ 하위로 분류.
    """
    # 출력 폴더 생성
    filtered_dir = inbox_dir.parent / "filtered"
    hea_dir = filtered_dir / "hea"
    maybe_dir = filtered_dir / "maybe"
    reject_dir = filtered_dir / "reject"
    for d in [hea_dir, maybe_dir, reject_dir]:
        d.mkdir(parents=True, exist_ok=True)

    # PDF 목록
    pdfs = sorted(inbox_dir.glob("*.pdf"))
    if not pdfs:
        log.warning(f"PDF 없음: {inbox_dir}")
        return

    # 이미 filtered/ 하위에 존재하는 파일명 수집 → 스킵 대상
    already_done = (
        {p.name for p in hea_dir.glob("*.pdf")}
        | {p.name for p in maybe_dir.glob("*.pdf")}
        | {p.name for p in reject_dir.glob("*.pdf")}
    )
    if already_done:
        log.info(f"이미 처리된 파일 {len(already_done)}개 스킵 대상")

    log.info(f"필터링 시작: {len(pdfs)}개 파일 (method={method})")

    results = []
    counts = {"hea": 0, "maybe": 0, "reject": 0, "skipped": 0}

    for i, pdf_path in enumerate(pdfs, 1):
        log.info(f"[{i}/{len(pdfs)}] {pdf_path.name}")

        # 이미 처리된 파일 스킵
        if pdf_path.name in already_done:
            log.info(f"  ⏭️  스킵 (이미 처리됨)")
            counts["skipped"] += 1
            continue

        # 1차 필터링
        if method == "heuristic":
            label, conf, reason = heuristic_filter(
                extract_text_first_pages(pdf_path)
            )
        else:  # vision (기본)
            # 먼저 heuristic으로 빠른 스크린
            text = extract_text_first_pages(pdf_path)
            h_label, h_conf, h_reason = heuristic_filter(text)

            # heuristic 확신 높으면 바로 결정 (Vision 생략)
            if h_conf >= 0.85:
                label, conf, reason = h_label, h_conf, f"[Heuristic] {h_reason}"
                log.info(f"  Heuristic 확신: {label} ({conf:.2f})")
            else:
                # Vision으로 재판단
                label, conf, reason = vision_filter(pdf_path)
                reason = f"[Vision] {reason}"
                log.info(f"  Vision 판단: {label} ({conf:.2f})")

        # 이동
        if label == "hea":
            dest = hea_dir / pdf_path.name
            icon = "✅"
        elif label == "reject":
            dest = reject_dir / pdf_path.name
            icon = "❌"
        else:
            dest = maybe_dir / pdf_path.name
            icon = "⚠️ "

        shutil.copy2(pdf_path, dest)
        counts[label] += 1
        log.info(f"  {icon} {label}/ → {reason}")

        results.append({
            "file": pdf_path.name,
            "label": label,
            "confidence": conf,
            "reason": reason,
        })

    # API 재확인 (--api-verify 옵션)
    if api_verify_maybe:
        maybe_pdfs = sorted(maybe_dir.glob("*.pdf"))
        if maybe_pdfs:
            log.info(f"\n=== API 재확인: {len(maybe_pdfs)}개 Maybe ===")
            for pdf_path in maybe_pdfs:
                log.info(f"재확인: {pdf_path.name}")
                label, conf, reason = api_verify(pdf_path)
                reason = f"[API] {reason}"

                if label == "hea":
                    dest = hea_dir / pdf_path.name
                    counts["maybe"] -= 1
                    counts["hea"] += 1
                    icon = "✅→hea"
                elif label == "reject":
                    dest = reject_dir / pdf_path.name
                    counts["maybe"] -= 1
                    counts["reject"] += 1
                    icon = "❌→reject"
                else:
                    continue  # maybe 유지

                shutil.copy2(pdf_path, dest)
                pdf_path.unlink()  # maybe에서 삭제
                log.info(f"  {icon} ({conf:.2f}) {reason}")

                # results 업데이트
                for r in results:
                    if r["file"] == pdf_path.name:
                        r["label"] = label
                        r["confidence"] = conf
                        r["reason"] = reason

                time.sleep(2)  # Rate limit 방지

    # 요약 저장
    summary = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "method": method,
        "api_verify": api_verify_maybe,
        "total": len(pdfs),
        "counts": counts,
        "results": results,
    }
    summary_path = filtered_dir / "filtering_summary.json"
    summary_path.write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    # 메타데이터 분기 저장 (이번 실행에서 새로 처리된 것만 반영)
    if results:
        split_metadata(filtered_dir, results)

    log.info(f"\n{'='*50}")
    log.info(f"=== 필터링 완료 ===")
    log.info(f"✅ HEA   : {counts['hea']}개 → papers/filtered/hea/")
    log.info(f"⚠️  MAYBE : {counts['maybe']}개 → papers/filtered/maybe/")
    log.info(f"❌ REJECT: {counts['reject']}개 → papers/filtered/reject/")
    log.info(f"⏭️  SKIP  : {counts['skipped']}개 (이미 처리됨)")
    log.info(f"📄 요약  : {summary_path}")
    log.info(f"{'='*50}")


# ─────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="BCC HEA 논문 필터링")
    parser.add_argument("inbox_dir", help="PDF가 있는 폴더 경로")
    parser.add_argument(
        "--method",
        choices=["heuristic", "vision"],
        default="vision",
        help="필터링 방법 (기본: vision)",
    )
    parser.add_argument(
        "--api-verify",
        action="store_true",
        help="Maybe 폴더를 Claude API로 재확인 (유료)",
    )
    args = parser.parse_args()

    inbox = Path(args.inbox_dir)
    if not inbox.exists():
        log.error(f"폴더 없음: {inbox}")
        sys.exit(1)

    filter_papers(inbox, method=args.method, api_verify_maybe=args.api_verify)


if __name__ == "__main__":
    main()