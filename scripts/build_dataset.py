"""
build_dataset.py
=================
data/validated/*.json 을 모두 합쳐 다음 두 파일을 생성한다.

1. data/master_dataset.json  — 정규화 구조 그대로 (papers / alloys / samples / measurements)
2. data/master_dataset.csv   — 학습용 평탄화 wide table (1 row = 1 measurement)

추가 처리:
- is_BCC_single, is_target_met, bcc_phase_label 자동 라벨링
- dataset_version_tag 부여
- 간단 통계 출력

사용법:
    python scripts/build_dataset.py
"""

import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
VALIDATED_DIR = ROOT / "data" / "validated"
MASTER_JSON = ROOT / "data" / "master_dataset.json"
MASTER_CSV = ROOT / "data" / "master_dataset.csv"
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "build.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("build")

DATASET_VERSION_TAG = f"ds_{datetime.now(timezone.utc).strftime('%Y%m%d')}"

TARGET_ELEMENTS = ["Ti", "Zr", "Hf", "V", "Nb", "Ta", "Cr", "Mo", "W", "Al"]


def auto_label(meas: dict, alloy: dict) -> dict:
    """measurement에 ML 라벨 부여."""
    bcc_frac = meas.get("BCC_fraction_pct")
    phase_str = (meas.get("phase_structure") or "").lower()
    test_mode = meas.get("test_mode")
    test_temp = meas.get("test_temp_C")
    ys_src = meas.get("YS_source_type")
    ys = meas.get("YS_MPa")
    el = meas.get("elongation_pct")

    # is_BCC_single
    if bcc_frac is not None:
        is_bcc = 1 if bcc_frac > 90 else 0
        label_src = "experimental"
    elif "bcc" in phase_str and "single" in phase_str:
        is_bcc = 1
        label_src = "experimental"
    else:
        # descriptor rule fallback
        vec = alloy.get("VEC")
        delta = alloy.get("delta_pct")
        omega = alloy.get("Omega")
        dh = alloy.get("dH_mix_kJ")
        if all(v is not None for v in [vec, delta, omega, dh]):
            ok = (vec < 6.87) and (0 <= delta <= 8.5) and (omega >= 1.1) and (-22 <= dh <= 7)
            is_bcc = 1 if ok else 0
            label_src = "descriptor_rule"
        else:
            is_bcc = 0
            label_src = "manual_review"

    # bcc_phase_label
    if "amorphous" in phase_str:
        bcc_label = "amorphous"
    elif bcc_frac is not None:
        if bcc_frac > 90:
            bcc_label = "BCC_single"
        elif bcc_frac > 60:
            bcc_label = "BCC_plus_minor"
        else:
            bcc_label = "multiphase"
    elif is_bcc == 1:
        bcc_label = "BCC_single"
    else:
        bcc_label = "multiphase"

    # is_target_met (인장 + RT + measured 한정)
    is_target = 0
    if (
        test_mode == "tensile"
        and test_temp is not None and test_temp <= 100
        and ys_src in {"measured_tensile"}
        and ys is not None and ys > 1000
        and el is not None and el > 30
        and is_bcc == 1
    ):
        is_target = 1

    return {
        "is_BCC_single": is_bcc,
        "is_BCC_single_label_source": label_src,
        "bcc_phase_label": bcc_label,
        "is_target_met": is_target,
        "experiment_status": "literature",
        "active_learning_flag": 0,
        "uncertainty_score": None,
        "data_split": None,  # 클러스터링 후 별도 부여
        "dataset_version_tag": DATASET_VERSION_TAG,
        "model_version_tag": None,
    }


def flatten_to_rows(papers_data: list[dict]) -> list[dict]:
    """정규화 JSON → measurement 단위 wide row 리스트."""
    rows = []
    for d in papers_data:
        paper = d.get("paper", {})
        for alloy in d.get("alloys", []):
            for sample in alloy.get("samples", []):
                for meas in sample.get("measurements", []):
                    row = {}
                    # paper level
                    for k, v in paper.items():
                        row[f"paper.{k}"] = v
                    # alloy level (samples 제외)
                    for k, v in alloy.items():
                        if k == "samples":
                            continue
                        row[f"alloy.{k}"] = v
                    # sample level (measurements 제외)
                    for k, v in sample.items():
                        if k == "measurements":
                            continue
                        row[f"sample.{k}"] = v
                    # measurement level
                    for k, v in meas.items():
                        row[f"meas.{k}"] = v
                    rows.append(row)
    return rows


def main():
    files = sorted(VALIDATED_DIR.glob("*.json"))
    if not files:
        log.warning(f"validated 폴더 비어있음: {VALIDATED_DIR}")
        return

    log.info(f"빌드 시작: {len(files)}개 논문")
    all_papers = []
    n_alloys = n_samples = n_meas = 0

    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            log.error(f"{path.name} 로드 실패: {e}")
            continue

        # 자동 라벨링
        for alloy in data.get("alloys", []):
            n_alloys += 1
            for sample in alloy.get("samples", []):
                n_samples += 1
                for meas in sample.get("measurements", []):
                    n_meas += 1
                    labels = auto_label(meas, alloy)
                    meas.update(labels)

        all_papers.append(data)

    # 통합 JSON 저장
    master = {
        "metadata": {
            "dataset_version_tag": DATASET_VERSION_TAG,
            "build_timestamp": datetime.now(timezone.utc).isoformat(),
            "n_papers": len(all_papers),
            "n_alloys": n_alloys,
            "n_samples": n_samples,
            "n_measurements": n_meas,
        },
        "papers": all_papers,
    }
    MASTER_JSON.write_text(
        json.dumps(master, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    log.info(f"✅ master JSON 저장: {MASTER_JSON}")

    # 평탄화 CSV 저장
    rows = flatten_to_rows(all_papers)
    if rows:
        df = pd.DataFrame(rows)
        df.to_csv(MASTER_CSV, index=False, encoding="utf-8-sig")
        log.info(f"✅ master CSV 저장: {MASTER_CSV} (shape={df.shape})")

        # 간단 통계
        n_target_met = df.get("meas.is_target_met", pd.Series([0])).sum()
        n_bcc_single = df.get("meas.is_BCC_single", pd.Series([0])).sum()
        log.info(
            f"   요약: papers={len(all_papers)}, alloys={n_alloys}, "
            f"measurements={n_meas}, is_BCC_single={n_bcc_single}, "
            f"is_target_met={n_target_met}"
        )

    log.info(f"=== 빌드 완료 (version={DATASET_VERSION_TAG}) ===")


if __name__ == "__main__":
    main()
