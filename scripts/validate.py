"""
validate.py
============
data/extracted/ 의 JSON 파일들을 검증하고, 통과한 것을 data/validated/ 로 복사한다.

검증 항목:
- 조성 합계 95.0 ~ 105.0 at%  (LLM 추출 오차 허용)
- 대상 10원소 외 음수/이상값 없음
- YS, elongation 등 물성값 범위 체크 (test_mode별 상한 분리)
- 필수 메타데이터 존재 여부
- 인장/압축 모드와 YS_source_type 정합성

[수정 이력]
  v2 (2026-05-16):
    Fix 1. dynamic_compression — CRITICAL 제거, WARNING으로 변경
    Fix 2. YS 상한을 test_mode별로 분리
    Fix 3. critical / warning 완전 분리
    Fix 4. 검증 결과 로그 상세화
    Fix 5. 조성 합계 허용 범위 95.0~105.0
  v3 (2026-05-16):
    Fix 6. 검증 단위를 논문 → alloy 단위로 변경
           CRITICAL이 있는 alloy만 제외하고 논문은 살림.
           정상 alloy가 1개 이상이면 PASS → validated/ 복사.
           모든 alloy가 CRITICAL이면 논문 전체 FAIL.
           validated/ 복사 시 CRITICAL alloy가 제거된 JSON을 저장.

사용법:
    python scripts/validate.py
"""

import json
import logging
import shutil
import sys
from copy import deepcopy
from pathlib import Path

ROOT          = Path(__file__).resolve().parent.parent
EXTRACTED_DIR = ROOT / "data" / "extracted"
VALIDATED_DIR = ROOT / "data" / "validated"
LOG_DIR       = ROOT / "logs"
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

COMPOSITION_SUM_MIN = 95.0
COMPOSITION_SUM_MAX = 105.0

VALID_TEST_MODES = {
    "tensile",
    "compression",
    "micropillar_compression",
    "dynamic_compression",
    "nanoindentation",
    "bending",
    "hardness_only",
}

YS_UPPER = {
    "tensile":                 5000,
    "compression":             5000,
    "micropillar_compression": 15000,
    "dynamic_compression":     None,
    "nanoindentation":         5000,
    "bending":                 5000,
    "hardness_only":           5000,
}


# ══════════════════════════════════════════════════════════════
# alloy 검증
# ══════════════════════════════════════════════════════════════
def validate_alloy(alloy: dict) -> tuple[list[str], list[str]]:
    """
    단일 alloy 검증.
    반환: (critical_list, warning_list)
    critical → 이 alloy만 제외 (논문 전체 FAIL 아님)
    warning  → 통과하되 로그에 기록
    """
    critical, warnings = [], []
    aid = alloy.get("alloy_id", "?")

    total = 0.0
    for el in TARGET_ELEMENTS:
        v = alloy.get(f"{el}_at")
        if v is None:
            warnings.append(f"[{aid}] {el}_at 누락 — 0으로 처리")
            v = 0
        if v < 0:
            critical.append(f"[{aid}] {el}_at 음수: {v}")
        total += v

    if not (COMPOSITION_SUM_MIN <= total <= COMPOSITION_SUM_MAX):
        critical.append(
            f"[{aid}] 조성 합계 비정상: {total:.2f} at% "
            f"(허용: {COMPOSITION_SUM_MIN}~{COMPOSITION_SUM_MAX})"
        )
    elif not (99.0 <= total <= 101.0):
        warnings.append(
            f"[{aid}] 조성 합계 {total:.2f} at% — "
            f"허용 범위 내이나 100에서 벗어남 (LLM 추출 오차 가능)"
        )

    nonzero  = sum(1 for el in TARGET_ELEMENTS if (alloy.get(f"{el}_at") or 0) > 0)
    reported = alloy.get("n_elements")
    if reported is not None and reported != nonzero:
        warnings.append(
            f"[{aid}] n_elements 불일치: JSON={reported}, 실제={nonzero}"
        )

    return critical, warnings


# ══════════════════════════════════════════════════════════════
# measurement 검증
# ══════════════════════════════════════════════════════════════
def validate_measurement(meas: dict, alloy_id: str) -> tuple[list[str], list[str]]:
    """
    단일 measurement 검증.
    반환: (critical_list, warning_list)
    measurement CRITICAL은 해당 alloy 전체를 제외시킴.
    """
    critical, warnings = [], []
    mid       = meas.get("measurement_id", "?")
    test_mode = meas.get("test_mode")

    if test_mode not in VALID_TEST_MODES:
        critical.append(f"[{mid}] test_mode 미정의: '{test_mode}'")
    elif test_mode == "dynamic_compression":
        warnings.append(
            f"[{mid}] test_mode=dynamic_compression — "
            f"고변형률 시험값. 정적 모델 학습 시 db_setup에서 자동 제외."
        )
    elif test_mode == "micropillar_compression":
        warnings.append(
            f"[{mid}] test_mode=micropillar_compression — "
            f"나노 크기 효과 가능. db_setup에서 자동 제외."
        )

    ys = meas.get("YS_MPa")
    if ys is not None:
        upper = YS_UPPER.get(test_mode, 5000)
        if ys <= 0:
            critical.append(f"[{mid}] YS_MPa 비물리적(≤0): {ys}")
        elif upper is not None and ys >= upper:
            if test_mode == "micropillar_compression":
                warnings.append(f"[{mid}] YS={ys} MPa (micropillar, 크기 효과 가능)")
            else:
                critical.append(
                    f"[{mid}] YS={ys} MPa > {upper} MPa (mode={test_mode}) — "
                    f"DFT 오분류 또는 비현실적 값."
                )

    uts = meas.get("UTS_MPa")
    if uts is not None and ys is not None and uts < ys:
        warnings.append(f"[{mid}] UTS({uts}) < YS({ys}) — 비물리적, 확인 권장")

    el_val = meas.get("elongation_pct")
    if el_val is not None and not (0 <= el_val <= 100):
        critical.append(f"[{mid}] elongation_pct 범위 이상: {el_val}")

    bcc = meas.get("BCC_fraction_pct")
    if bcc is not None and not (0 <= bcc <= 100):
        critical.append(f"[{mid}] BCC_fraction_pct 범위 이상: {bcc}")

    t = meas.get("test_temp_C")
    if t is not None and not (-273 < t < 2000):
        critical.append(f"[{mid}] test_temp_C 범위 이상: {t}")

    ys_src = meas.get("YS_source_type")
    if ys_src == "measured_tensile" and test_mode != "tensile":
        warnings.append(f"[{mid}] YS_source_type=measured_tensile인데 test_mode={test_mode}")
    if ys_src == "measured_compression" and test_mode != "compression":
        warnings.append(f"[{mid}] YS_source_type=measured_compression인데 test_mode={test_mode}")

    conf = meas.get("extraction_confidence")
    if conf not in {"HIGH", "MED", "LOW", None}:
        warnings.append(f"[{mid}] extraction_confidence 비정상: {conf}")

    return critical, warnings


# ══════════════════════════════════════════════════════════════
# Fix 6: alloy 단위 검증 — CRITICAL alloy만 제거
# ══════════════════════════════════════════════════════════════
def validate_and_filter_alloys(data: dict) -> tuple[dict, list[str], list[str], int, int]:
    """
    Fix 6: alloy 단위로 검증.
    CRITICAL이 있는 alloy만 제거하고 나머지는 살림.

    반환:
        filtered_data   : CRITICAL alloy 제거된 JSON (복사본)
        warning_msgs    : 경고 메시지 목록
        critical_msgs   : 제거된 alloy의 CRITICAL 메시지 (로그용)
        n_kept          : 남은 alloy 수
        n_removed       : 제거된 alloy 수
    """
    filtered_data  = deepcopy(data)
    warning_msgs   = []
    critical_msgs  = []
    kept_alloys    = []
    n_removed      = 0

    for alloy in data.get("alloys", []):
        aid = alloy.get("alloy_id", "?")
        alloy_critical = []
        alloy_warnings = []

        # alloy 레벨 검증
        c, w = validate_alloy(alloy)
        alloy_critical.extend(c)
        alloy_warnings.extend(w)

        # measurement 레벨 검증
        for sample in alloy.get("samples", []):
            for meas in sample.get("measurements", []):
                c, w = validate_measurement(meas, aid)
                alloy_critical.extend(c)
                alloy_warnings.extend(w)

        if alloy_critical:
            # CRITICAL 있는 alloy 제거
            n_removed += 1
            critical_msgs.append(f"  alloy 제외: {aid}")
            for msg in alloy_critical:
                critical_msgs.append(f"    CRITICAL: {msg}")
        else:
            # 정상 alloy 유지
            kept_alloys.append(alloy)
            warning_msgs.extend(alloy_warnings)

    filtered_data["alloys"] = kept_alloys
    return filtered_data, warning_msgs, critical_msgs, len(kept_alloys), n_removed


# ══════════════════════════════════════════════════════════════
# 논문 전체 검증
# ══════════════════════════════════════════════════════════════
def validate_paper_json(data: dict) -> tuple[bool, dict, list[str], list[str]]:
    """
    전체 논문 JSON 검증.

    Fix 6:
    - CRITICAL alloy만 제거하고 정상 alloy가 1개 이상이면 PASS
    - 모든 alloy가 CRITICAL이면 논문 전체 FAIL
    - validated/ 에는 CRITICAL alloy가 제거된 JSON을 저장

    반환: (통과 여부, 필터링된 data, warning_msgs, critical_msgs)
    """
    paper = data.get("paper", {})
    pid   = paper.get("paper_id", "?")

    # 필수 메타 검증 — 없으면 논문 전체 FAIL (alloy 필터링 전에 체크)
    meta_critical = []
    for field in ["paper_id", "source_ref", "pdf_hash_md5"]:
        if not paper.get(field):
            meta_critical.append(f"[{pid}] 필수 메타 누락: {field}")

    if meta_critical:
        return False, data, [], meta_critical

    if not data.get("alloys"):
        return False, data, [], [f"[{pid}] alloys 없음"]

    # Fix 6: alloy 단위 필터링
    filtered_data, warning_msgs, critical_msgs, n_kept, n_removed = \
        validate_and_filter_alloys(data)

    if n_kept == 0:
        # 모든 alloy가 CRITICAL → 논문 전체 FAIL
        critical_msgs.insert(0, f"[{pid}] 유효한 alloy 없음 — 모든 alloy 제외됨")
        return False, data, warning_msgs, critical_msgs

    # 정상 alloy 1개 이상 → PASS (일부 제외 정보는 warning에 포함)
    if n_removed > 0:
        warning_msgs.insert(0,
            f"[{pid}] alloy {n_removed}개 제외, {n_kept}개 유지"
        )

    return True, filtered_data, warning_msgs, critical_msgs


# ══════════════════════════════════════════════════════════════
# main
# ══════════════════════════════════════════════════════════════
def main():
    files = sorted(EXTRACTED_DIR.glob("*.json"))
    if not files:
        log.warning(f"검증할 파일 없음: {EXTRACTED_DIR}")
        return

    log.info(f"검증 시작: {len(files)}개 파일")
    pass_count = fail_count = warn_count = 0
    total_removed_alloys = 0

    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            log.error(f"{path.name}: JSON 로드 실패 — {e}")
            fail_count += 1
            continue

        ok, filtered_data, warning_msgs, critical_msgs = validate_paper_json(data)
        pid = data.get("paper", {}).get("paper_id", path.stem)

        if not ok:
            fail_count += 1
            log.error(f"❌ FAIL  [{pid}]")
            for msg in critical_msgs:
                log.error(f"  {msg}")
            continue

        # alloy 일부 제외된 경우
        n_original = len(data.get("alloys", []))
        n_kept     = len(filtered_data.get("alloys", []))
        n_removed  = n_original - n_kept
        total_removed_alloys += n_removed

        if n_removed > 0 or warning_msgs:
            warn_count += 1
            log.warning(f"⚠️  WARN  [{pid}]")
            for msg in critical_msgs:   # 제외된 alloy 정보
                log.warning(f"  {msg}")
            for msg in warning_msgs:
                log.warning(f"  WARNING: {msg}")
        else:
            pass_count += 1
            log.info(f"✅ PASS  [{pid}]")

        # Fix 6: CRITICAL alloy 제거된 JSON을 validated/에 저장
        dest = VALIDATED_DIR / path.name
        dest.write_text(
            json.dumps(filtered_data, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )
        log.info(f"         → {dest.relative_to(ROOT)}  "
                 f"(alloy {n_kept}/{n_original}개 유지)")

    log.info(
        f"\n{'='*50}"
        f"\n  검증 완료"
        f"\n{'='*50}"
        f"\n  PASS         : {pass_count}편"
        f"\n  WARN(통과)   : {warn_count}편  ← alloy 일부 제외 또는 경고"
        f"\n  FAIL(제외)   : {fail_count}편  ← validated/ 미포함"
        f"\n  합계         : {len(files)}편"
        f"\n  제거된 alloy : {total_removed_alloys}개"
        f"\n{'='*50}"
    )
    if fail_count > 0:
        log.warning(
            "FAIL 논문은 data/extracted/ 원본이 그대로 있습니다.\n"
            "  logs/validation.log 에서 내용 확인 후 JSON 수정 → 재실행하세요."
        )


if __name__ == "__main__":
    main()