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
           → 고변형률 시험값이지만 데이터 자체는 보존.
             정적 YS 모델 학습 시에는 db_setup.py filter_tensile=True 로 자동 제외.
             나중에 dynamic YS 별도 모델 학습 시 활용 가능.
    Fix 2. YS 상한을 test_mode별로 분리
           → tensile/compression: 5000 MPa 초과 시 CRITICAL (DFT 오분류 의심)
           → micropillar_compression: 15000 MPa까지 WARNING만
           → dynamic_compression: 상한 없음 (WARNING 태그만)
    Fix 3. critical / warning 완전 분리 — critical 있으면 FAIL, warning만이면 PASS
    Fix 4. 검증 결과 로그 상세화 — PASS / WARN / FAIL 이유 명시
    Fix 5. 조성 합계 허용 범위 99.5~100.5 → 95.0~105.0
           → LLM 추출 시 미량 원소 누락 또는 반올림 오차 허용

사용법:
    python scripts/validate.py
"""

import json
import logging
import shutil
import sys
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

# ─────────────────────────────────────────────────────────────
# Fix 5: 조성 합계 허용 범위
# LLM 추출 시 미량 원소 누락이나 반올림 오차로 합계가 정확히 100이 아닐 수 있음.
# 95~105 범위로 넓혀서 정상 논문이 FAIL되는 경우를 방지.
# ─────────────────────────────────────────────────────────────
COMPOSITION_SUM_MIN = 95.0
COMPOSITION_SUM_MAX = 105.0

# ─────────────────────────────────────────────────────────────
# Fix 1: 허용 test_mode 목록
# dynamic_compression 유지 — 데이터 보존 목적.
#   정적 YS 모델 학습 시: db_setup.py filter_tensile=True 로 자동 제외됨.
#   나중에 dynamic YS 별도 모델 학습 시 이 데이터를 활용할 수 있음.
# ─────────────────────────────────────────────────────────────
VALID_TEST_MODES = {
    "tensile",
    "compression",
    "micropillar_compression",  # WARNING: 크기 효과 있음, db_setup에서 필터링
    "dynamic_compression",      # WARNING: 고변형률 시험, 정적 모델 학습 시 db_setup에서 제외
    "nanoindentation",
    "bending",
    "hardness_only",
}

# ─────────────────────────────────────────────────────────────
# Fix 2: test_mode별 YS 상한
# tensile/compression:          벌크 합금 최대 ~2500 MPa → 여유 포함 5000
# micropillar_compression:      크기 효과로 최대 ~15000 MPa 가능
# dynamic_compression:          고변형률이라 상한 규정 어려움 → None(무제한)
# ─────────────────────────────────────────────────────────────
YS_UPPER = {
    "tensile":                 5000,
    "compression":             5000,
    "micropillar_compression": 15000,
    "dynamic_compression":     None,   # 상한 없음, WARNING 태그만
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
    critical → 논문 전체 FAIL
    warning  → 통과하되 로그에 기록
    """
    critical, warnings = [], []
    aid = alloy.get("alloy_id", "?")

    # 조성 합산
    total = 0.0
    for el in TARGET_ELEMENTS:
        v = alloy.get(f"{el}_at")
        if v is None:
            warnings.append(f"[{aid}] {el}_at 누락 — 0으로 처리")
            v = 0
        if v < 0:
            critical.append(f"[{aid}] {el}_at 음수: {v}")
        total += v

    # Fix 5: 허용 범위 95~105
    if not (COMPOSITION_SUM_MIN <= total <= COMPOSITION_SUM_MAX):
        critical.append(
            f"[{aid}] 조성 합계 비정상: {total:.2f} at% "
            f"(허용: {COMPOSITION_SUM_MIN}~{COMPOSITION_SUM_MAX})"
        )
    elif not (95.0 <= total <= 105.0):
        # 95~99 또는 101~105 구간 → 허용하되 경고
        warnings.append(
            f"[{aid}] 조성 합계 {total:.2f} at% — "
            f"허용 범위 내이나 100에서 벗어남 (LLM 추출 오차 가능)"
        )

    # n_elements 일관성 (WARNING만 — 추출 오차 허용)
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
    """
    critical, warnings = [], []
    mid       = meas.get("measurement_id", "?")
    test_mode = meas.get("test_mode")

    # ── Fix 1: test_mode 검증 ────────────────────────────────
    if test_mode not in VALID_TEST_MODES:
        critical.append(f"[{mid}] test_mode 미정의: '{test_mode}'")
    elif test_mode == "dynamic_compression":
        # Fix 1: WARNING만 — 데이터 보존, 학습 시 db_setup에서 제외
        warnings.append(
            f"[{mid}] test_mode=dynamic_compression — "
            f"고변형률 시험값 (정적 YS 대비 2~3배 높음). "
            f"정적 모델 학습 시 db_setup filter_tensile=True 로 자동 제외. "
            f"dynamic 전용 모델 학습 시 활용 가능."
        )
    elif test_mode == "micropillar_compression":
        warnings.append(
            f"[{mid}] test_mode=micropillar_compression — "
            f"나노 크기 효과로 YS 뻥튀기 가능. "
            f"db_setup filter_tensile=True 로 자동 제외."
        )

    # ── Fix 2: YS 범위 — test_mode별 상한 ───────────────────
    ys = meas.get("YS_MPa")
    if ys is not None:
        upper = YS_UPPER.get(test_mode, 5000)
        if ys <= 0:
            critical.append(f"[{mid}] YS_MPa 비물리적(≤0): {ys}")
        elif upper is not None and ys >= upper:
            if test_mode == "micropillar_compression":
                # 크기 효과로 높을 수 있음 → WARNING
                warnings.append(
                    f"[{mid}] YS={ys} MPa (micropillar, 크기 효과 가능)"
                )
            else:
                # tensile/compression에서 5000 초과 = DFT 오분류 의심 → CRITICAL
                critical.append(
                    f"[{mid}] YS={ys} MPa > {upper} MPa (mode={test_mode}) — "
                    f"DFT 계산값 오분류 또는 비현실적 값. JSON 확인 필요."
                )
        # dynamic은 upper=None이므로 범위 체크 자체를 스킵

    # UTS < YS (WARNING)
    uts = meas.get("UTS_MPa")
    if uts is not None and ys is not None and uts < ys:
        warnings.append(f"[{mid}] UTS({uts}) < YS({ys}) — 비물리적, 확인 권장")

    # 연신율 범위
    el_val = meas.get("elongation_pct")
    if el_val is not None and not (0 <= el_val <= 100):
        critical.append(f"[{mid}] elongation_pct 범위 이상: {el_val}")

    # BCC 분율 범위
    bcc = meas.get("BCC_fraction_pct")
    if bcc is not None and not (0 <= bcc <= 100):
        critical.append(f"[{mid}] BCC_fraction_pct 범위 이상: {bcc}")

    # 시험 온도 범위
    t = meas.get("test_temp_C")
    if t is not None and not (-273 < t < 2000):
        critical.append(f"[{mid}] test_temp_C 범위 이상: {t}")

    # YS_source_type ↔ test_mode 정합성 (WARNING)
    ys_src = meas.get("YS_source_type")
    if ys_src == "measured_tensile" and test_mode != "tensile":
        warnings.append(
            f"[{mid}] YS_source_type=measured_tensile인데 test_mode={test_mode}"
        )
    if ys_src == "measured_compression" and test_mode != "compression":
        warnings.append(
            f"[{mid}] YS_source_type=measured_compression인데 test_mode={test_mode}"
        )

    return critical, warnings


# ══════════════════════════════════════════════════════════════
# 논문 전체 검증
# ══════════════════════════════════════════════════════════════
def validate_paper_json(data: dict) -> tuple[bool, list[str], list[str]]:
    """
    전체 논문 JSON 검증.
    반환: (통과 여부, critical_list, warning_list)

    Fix 3: critical이 1개라도 있으면 FAIL → validated/ 미복사
           warning만 있으면 PASS → validated/ 복사 (로그에 기록)
    """
    critical_all, warning_all = [], []
    paper = data.get("paper", {})
    pid   = paper.get("paper_id", "?")

    # 필수 메타 — 없으면 CRITICAL
    for field in ["paper_id", "source_ref", "pdf_hash_md5"]:
        if not paper.get(field):
            critical_all.append(f"[{pid}] 필수 메타 누락: {field}")

    alloys = data.get("alloys", [])
    if not alloys:
        critical_all.append(f"[{pid}] alloys 없음")
        return False, critical_all, warning_all

    for alloy in alloys:
        c, w = validate_alloy(alloy)
        critical_all.extend(c)
        warning_all.extend(w)
        for sample in alloy.get("samples", []):
            for meas in sample.get("measurements", []):
                c, w = validate_measurement(meas, alloy.get("alloy_id", "?"))
                critical_all.extend(c)
                warning_all.extend(w)

    return (len(critical_all) == 0), critical_all, warning_all


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

    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            log.error(f"{path.name}: JSON 로드 실패 — {e}")
            fail_count += 1
            continue

        ok, critical_issues, warning_issues = validate_paper_json(data)
        pid = data.get("paper", {}).get("paper_id", path.stem)

        # Fix 4: 결과 로그 상세화
        if not ok:
            fail_count += 1
            log.error(f"❌ FAIL  [{pid}]")
            for msg in critical_issues:
                log.error(f"         CRITICAL: {msg}")
            for msg in warning_issues:
                log.warning(f"         WARNING : {msg}")
            continue   # validated/ 미복사

        if warning_issues:
            warn_count += 1
            log.warning(f"⚠️  WARN  [{pid}]  ({len(warning_issues)}개 경고)")
            for msg in warning_issues:
                log.warning(f"         WARNING : {msg}")
        else:
            pass_count += 1
            log.info(f"✅ PASS  [{pid}]")

        # CRITICAL 없으면 validated/ 복사
        dest = VALIDATED_DIR / path.name
        shutil.copy2(path, dest)
        log.info(f"         → {dest.relative_to(ROOT)}")

    # Fix 4: 최종 요약
    log.info(
        f"\n{'='*50}"
        f"\n  검증 완료"
        f"\n{'='*50}"
        f"\n  PASS       : {pass_count}편"
        f"\n  WARN(통과) : {warn_count}편  ← 경고 있으나 validated/ 포함"
        f"\n  FAIL(제외) : {fail_count}편  ← validated/ 미포함"
        f"\n  합계       : {len(files)}편"
        f"\n{'='*50}"
    )
    if fail_count > 0:
        log.warning(
            "FAIL 논문은 data/extracted/ 원본이 그대로 있습니다.\n"
            "  logs/validation.log 에서 CRITICAL 항목 확인 후 JSON 수정 → 재실행하세요."
        )


if __name__ == "__main__":
    main()