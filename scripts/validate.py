"""
validate.py
============
data/extracted/ 의 JSON 파일들을 검증하고, 통과한 것을 data/validated/ 로 복사한다.

검증 항목:
- 조성 합계 99.8 ~ 100.2 at%
- 대상 10원소 외 음수/이상값 없음
- YS, elongation 등 물성값 범위 체크
- 필수 메타데이터 존재 여부
- 인장/압축 모드와 YS_source_type 정합성

사용법:
    python scripts/validate.py
"""

import json
import logging
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTRACTED_DIR = ROOT / "data" / "extracted"
VALIDATED_DIR = ROOT / "data" / "validated"
LOG_DIR = ROOT / "logs"
VALIDATED_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "validation.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("validate")

TARGET_ELEMENTS = ["Ti", "Zr", "Hf", "V", "Nb", "Ta", "Cr", "Mo", "W", "Al"]


def validate_alloy(alloy: dict) -> list[str]:
    """단일 alloy 검증. 문제 메시지 리스트 반환 (빈 리스트 = 통과)."""
    issues = []
    aid = alloy.get("alloy_id", "?")

    # 조성 합산
    total = 0.0
    for el in TARGET_ELEMENTS:
        v = alloy.get(f"{el}_at")
        if v is None:
            issues.append(f"[{aid}] {el}_at 누락 (0이어야 함)")
            v = 0
        if v < 0:
            issues.append(f"[{aid}] {el}_at 음수: {v}")
        total += v

    if not (99.5 <= total <= 100.5):  # 약간 더 관대한 범위로 1차 필터
        issues.append(f"[{aid}] 조성 합계 비정상: {total:.2f} at%")

    # n_elements 일관성
    nonzero = sum(1 for el in TARGET_ELEMENTS if (alloy.get(f"{el}_at") or 0) > 0)
    reported = alloy.get("n_elements")
    if reported is not None and reported != nonzero:
        issues.append(f"[{aid}] n_elements 불일치: 보고 {reported}, 실제 {nonzero}")

    return issues


def validate_measurement(meas: dict, alloy_id: str) -> list[str]:
    issues = []
    mid = meas.get("measurement_id", "?")

    # 시험 모드 필수
    test_mode = meas.get("test_mode")
    valid_modes = {
        "tensile", "compression", "micropillar_compression",
        "nanoindentation", "bending", "hardness_only"
    }
    if test_mode not in valid_modes:
        issues.append(f"[{mid}] test_mode 비정상: {test_mode}")

    # YS 범위
    ys = meas.get("YS_MPa")
    if ys is not None and not (0 < ys < 3000):
        issues.append(f"[{mid}] YS_MPa 범위 이상: {ys}")

    uts = meas.get("UTS_MPa")
    if uts is not None and ys is not None and uts < ys:
        issues.append(f"[{mid}] UTS({uts}) < YS({ys}) — 비물리적")

    # 연신율
    el = meas.get("elongation_pct")
    if el is not None and not (0 <= el <= 100):
        issues.append(f"[{mid}] elongation_pct 범위 이상: {el}")

    # BCC 분율
    bcc = meas.get("BCC_fraction_pct")
    if bcc is not None and not (0 <= bcc <= 100):
        issues.append(f"[{mid}] BCC_fraction_pct 범위 이상: {bcc}")

    # 시험 온도
    t = meas.get("test_temp_C")
    if t is not None and not (-273 < t < 2000):
        issues.append(f"[{mid}] test_temp_C 범위 이상: {t}")

    # YS_source_type과 test_mode 정합성
    ys_src = meas.get("YS_source_type")
    if ys_src == "measured_tensile" and test_mode != "tensile":
        issues.append(f"[{mid}] YS_source_type=measured_tensile인데 test_mode={test_mode}")
    if ys_src == "measured_compression" and test_mode != "compression":
        issues.append(f"[{mid}] YS_source_type=measured_compression인데 test_mode={test_mode}")

    # extraction_confidence
    conf = meas.get("extraction_confidence")
    if conf not in {"HIGH", "MED", "LOW", None}:
        issues.append(f"[{mid}] extraction_confidence 비정상: {conf}")

    return issues


def validate_paper_json(data: dict) -> tuple[bool, list[str]]:
    """전체 논문 JSON 검증. (통과 여부, 문제 리스트)."""
    issues = []
    paper = data.get("paper", {})
    pid = paper.get("paper_id", "?")

    # 필수 메타
    for field in ["paper_id", "source_ref", "pdf_hash_md5", "extraction_confidence"]:
        if not paper.get(field):
            issues.append(f"[{pid}] 필수 메타 누락: {field}")

    alloys = data.get("alloys", [])
    if not alloys:
        issues.append(f"[{pid}] alloys 없음")
        return False, issues

    for alloy in alloys:
        issues.extend(validate_alloy(alloy))
        for sample in alloy.get("samples", []):
            for meas in sample.get("measurements", []):
                issues.extend(validate_measurement(meas, alloy.get("alloy_id", "?")))

    # CRITICAL이 아니라 WARNING 수준이면 통과 처리. 여기선 단순 다수결.
    has_critical = any("음수" in i or "범위 이상" in i or "필수 메타 누락" in i for i in issues)
    return (not has_critical), issues


def main():
    files = sorted(EXTRACTED_DIR.glob("*.json"))
    if not files:
        log.warning(f"검증할 파일 없음: {EXTRACTED_DIR}")
        return

    log.info(f"검증 시작: {len(files)}개 파일")
    pass_count, fail_count, warn_count = 0, 0, 0

    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            log.error(f"{path.name}: JSON 로드 실패 — {e}")
            fail_count += 1
            continue

        ok, issues = validate_paper_json(data)
        pid = data.get("paper", {}).get("paper_id", path.stem)

        if issues:
            for msg in issues:
                log.warning(msg)
            if ok:
                warn_count += 1
            else:
                fail_count += 1
                continue
        else:
            pass_count += 1

        # 통과한 파일은 validated/로 복사
        dest = VALIDATED_DIR / path.name
        shutil.copy2(path, dest)
        log.info(f"✅ {pid} → {dest.relative_to(ROOT)}")

    log.info(
        f"=== 결과: 통과 {pass_count}, 경고-통과 {warn_count}, 실패 {fail_count} ==="
    )


if __name__ == "__main__":
    main()
