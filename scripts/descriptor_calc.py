"""
descriptor_calc.py
===================
조성 정보로부터 물리 descriptor를 계산해 alloy 객체에 채워넣는다.

계산 항목:
- VEC, delta_pct, dH_mix_kJ (Miedema binary), dS_mix_J,
  Tm_mix_K, Tm_std_K, density_calc_gcm3, Omega, delta_chi,
  chi_mean, r_mean_A, G_mean_GPa, B_mean_GPa, Lambda

사용법:
    python scripts/descriptor_calc.py
    → data/validated/*.json 의 모든 alloy에 descriptor를 채워서 in-place 갱신.
"""

import json
import logging
import math
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
VALIDATED_DIR = ROOT / "data" / "validated"
ELEMENT_TABLE = ROOT / "schemas" / "element_property_table.csv"
MIEDEMA_TABLE = ROOT / "schemas" / "miedema_matrix.csv"
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

DESCRIPTOR_TABLE_VERSION = "desc_v1.0"
DESCRIPTOR_CALC_SCRIPT_VERSION = "calc_v1.0"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "descriptor.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("descriptor")

R_GAS = 8.314  # J/(K·mol)
TARGET_ELEMENTS = ["Ti", "Zr", "Hf", "V", "Nb", "Ta", "Cr", "Mo", "W", "Al"]


def load_element_table() -> dict:
    df = pd.read_csv(ELEMENT_TABLE).set_index("element")
    return df.to_dict(orient="index")


def load_miedema_matrix() -> dict:
    df = pd.read_csv(MIEDEMA_TABLE).set_index("element")
    return {(i, j): df.loc[i, j] for i in df.index for j in df.columns}


def fractions_from_alloy(alloy: dict) -> dict:
    """alloy dict에서 at% 추출 → 분율(0~1) dict 반환. 합산 1로 정규화."""
    frac = {}
    for el in TARGET_ELEMENTS:
        v = alloy.get(f"{el}_at") or 0
        if v > 0:
            frac[el] = float(v)
    total = sum(frac.values())
    if total <= 0:
        return {}
    return {k: v / total for k, v in frac.items()}


def calc_descriptors(c: dict, elem: dict, miedema: dict) -> dict:
    """
    c: {element: fraction(0~1)} — 합 1로 정규화된 조성
    elem: {element: {r_A, chi_pauling, VEC, Tm_K, density_gcm3, M_gmol, G_GPa, B_GPa}}
    miedema: {(i,j): H_ij_kJmol}
    """
    if not c:
        return {}

    # 평균값
    r_mean = sum(c[el] * elem[el]["r_A"] for el in c)
    chi_mean = sum(c[el] * elem[el]["chi_pauling"] for el in c)
    vec = sum(c[el] * elem[el]["VEC"] for el in c)
    tm_mix = sum(c[el] * elem[el]["Tm_K"] for el in c)
    g_mean = sum(c[el] * elem[el]["G_GPa"] for el in c)
    b_mean = sum(c[el] * elem[el]["B_GPa"] for el in c)

    # delta_pct = sqrt( sum( c_i * (1 - r_i / r_mean)^2 ) ) * 100
    delta = math.sqrt(sum(c[el] * (1 - elem[el]["r_A"] / r_mean) ** 2 for el in c)) * 100

    # delta_chi
    delta_chi = math.sqrt(
        sum(c[el] * (elem[el]["chi_pauling"] - chi_mean) ** 2 for el in c)
    )

    # Tm_std
    tm_std = math.sqrt(
        sum(c[el] * (elem[el]["Tm_K"] - tm_mix) ** 2 for el in c)
    )

    # dS_mix = -R * sum(c_i * ln(c_i)), J/(K·mol)
    ds_mix = -R_GAS * sum(c[el] * math.log(c[el]) for el in c if c[el] > 0)

    # dH_mix (Miedema binary): sum_{i<j} 4 * H_ij * c_i * c_j
    elements = list(c.keys())
    dh_mix = 0.0
    for i in range(len(elements)):
        for j in range(i + 1, len(elements)):
            ei, ej = elements[i], elements[j]
            h_ij = miedema.get((ei, ej), miedema.get((ej, ei), 0))
            dh_mix += 4 * h_ij * c[ei] * c[ej]

    # density (rule of mixtures, mass-weighted)
    sum_cM = sum(c[el] * elem[el]["M_gmol"] for el in c)
    sum_cM_rho = sum(c[el] * elem[el]["M_gmol"] / elem[el]["density_gcm3"] for el in c)
    density_calc = sum_cM / sum_cM_rho if sum_cM_rho > 0 else None

    # Omega = Tm_mix * dS_mix / |dH_mix*1000|  (dH는 kJ/mol → J/mol로 환산)
    abs_dh_J = abs(dh_mix) * 1000
    omega = (tm_mix * ds_mix / abs_dh_J) if abs_dh_J > 1e-6 else None

    # Lambda = dS_mix / delta^2  (delta는 % 단위 그대로 사용)
    lam = ds_mix / (delta ** 2) if delta > 1e-6 else None

    return {
        "VEC": round(vec, 4),
        "delta_pct": round(delta, 4),
        "dH_mix_kJ": round(dh_mix, 4),
        "dS_mix_J": round(ds_mix, 4),
        "Tm_mix_K": round(tm_mix, 2),
        "Tm_std_K": round(tm_std, 2),
        "density_calc_gcm3": round(density_calc, 4) if density_calc else None,
        "Omega": round(omega, 4) if omega else None,
        "delta_chi": round(delta_chi, 4),
        "chi_mean": round(chi_mean, 4),
        "r_mean_A": round(r_mean, 4),
        "G_mean_GPa": round(g_mean, 2),
        "B_mean_GPa": round(b_mean, 2),
        "Lambda": round(lam, 6) if lam else None,
        "VEC_definition": "Guo",
        "descriptor_table_version": DESCRIPTOR_TABLE_VERSION,
        "descriptor_calc_script_version": DESCRIPTOR_CALC_SCRIPT_VERSION,
    }


def process_file(path: Path, elem: dict, miedema: dict) -> int:
    data = json.loads(path.read_text(encoding="utf-8"))
    updated = 0
    for alloy in data.get("alloys", []):
        c = fractions_from_alloy(alloy)
        if not c:
            log.warning(f"{path.name} / {alloy.get('alloy_id')}: 유효 조성 없음")
            continue
        desc = calc_descriptors(c, elem, miedema)
        alloy.update(desc)
        updated += 1
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return updated


def main():
    if not ELEMENT_TABLE.exists():
        log.error(f"원소 테이블 없음: {ELEMENT_TABLE}")
        return
    if not MIEDEMA_TABLE.exists():
        log.error(f"Miedema 행렬 없음: {MIEDEMA_TABLE}")
        return

    elem = load_element_table()
    miedema = load_miedema_matrix()

    files = sorted(VALIDATED_DIR.glob("*.json"))
    if not files:
        log.warning(f"validated 폴더 비어있음: {VALIDATED_DIR}")
        return

    log.info(f"Descriptor 계산 시작: {len(files)}개 파일")
    total = 0
    for path in files:
        try:
            n = process_file(path, elem, miedema)
            total += n
            log.info(f"✅ {path.name}: {n}개 alloy 업데이트")
        except Exception as e:
            log.error(f"❌ {path.name}: {e}")
    log.info(f"=== 완료: 총 {total}개 alloy descriptor 계산 ===")


if __name__ == "__main__":
    main()
