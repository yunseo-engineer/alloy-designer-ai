"""
db_setup.py
=================
HEA Designer — DB 적재 + 전처리 + DB 업데이트

실행:
    python scripts/db_setup.py

순서:
    1. CSV 로드 및 기본 탐색
    2. SQLite 적재 (measurements / v_ml_features / experiment_log)
    3. DB 값 업데이트
       - is_target_met      재계산 (YS>1000 AND 연신율>30 AND BCC>90)
       - composition_formula 생성 (Ti25Nb25Ta25Mo25 형식)
       - data_split          조성 클러스터 기반 분할 (train70/val15/test15)
       - uncertainty_score   초기값 1.0 세팅
       - v_ml_features 뷰   재생성 (신규 컬럼 반영)
    4. ML 학습셋 구성 → ml_data.pkl 저장
    5. EDA 시각화
    6. 수치 필터링 쿼리 테스트

출력:
    data/hea_designer.db     <- SQLite DB
    data/cache/ml_data.pkl   <- ML 학습셋 캐시
    data/cache/*.png         <- EDA 시각화
"""

import pickle
import sqlite3
import warnings
from pathlib import Path

import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

matplotlib.rcParams["font.family"] = "DejaVu Sans"
matplotlib.rcParams["axes.unicode_minus"] = False
warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────
# 경로 설정
# ─────────────────────────────────────────────────────────────
ROOT      = Path(__file__).resolve().parent.parent
DATA_DIR  = ROOT / "data"
CSV_PATH  = DATA_DIR / "master_dataset.csv"
DB_PATH   = DATA_DIR / "hea_designer.db"
CACHE_DIR = DATA_DIR / "cache"

CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────────────────────
# 컬럼 정의
# ─────────────────────────────────────────────────────────────
ELEMENTS     = ["Ti", "Zr", "Hf", "V", "Nb", "Ta", "Cr", "Mo", "W", "Al"]
ELEM_COLS    = [f"alloy.{e}_at" for e in ELEMENTS]        # CSV 컬럼명
ELEM_COLS_DB = [f"alloy_{e}_at" for e in ELEMENTS]        # DB 컬럼명

DESC_COLS = [
    "alloy.VEC", "alloy.delta_pct", "alloy.dH_mix_kJ",
    "alloy.dS_mix_J", "alloy.Tm_mix_K",
    "alloy.density_calc_gcm3", "alloy.Omega", "alloy.Lambda",
]
TARGET_COLS = [
    "meas.YS_MPa", "meas.elongation_pct",
    "meas.BCC_fraction_pct", "meas.hardness_HV",
]
PROCESS_COLS = []

# KPI 기준
YS_KPI  = 1000.0
EL_KPI  = 30.0
BCC_KPI = 90.0

# BCC 안정 규칙 (시각화 기준선)
BCC_RULES = {
    "alloy.VEC":       (None, 6.87),
    "alloy.delta_pct": (0,    8.5),
    "alloy.dH_mix_kJ": (-22,  7),
    "alloy.dS_mix_J":  (11,   19.5),
    "alloy.Omega":     (1.1,  None),
}


# ══════════════════════════════════════════════════════════════
# 1. CSV 로드 및 기본 탐색
# ══════════════════════════════════════════════════════════════
def load_and_explore(csv_path: Path) -> pd.DataFrame:
    print("\n" + "="*55)
    print("  1. CSV 로드 및 기본 탐색")
    print("="*55)

    assert csv_path.exists(), f"CSV not found: {csv_path}"
    df = pd.read_csv(csv_path, encoding="utf-8-sig")
    print(f"Shape: {df.shape}  ->  {df.shape[0]}행 x {df.shape[1]}컬럼")

    groups = {
        "paper":  [c for c in df.columns if c.startswith("paper.")],
        "alloy":  [c for c in df.columns if c.startswith("alloy.")],
        "sample": [c for c in df.columns if c.startswith("sample.")],
        "meas":   [c for c in df.columns if c.startswith("meas.")],
    }
    for g, gc in groups.items():
        print(f"  {g:<8} 컬럼: {len(gc)}개")

    print("\n[핵심 컬럼 존재 확인]")
    required = {
        "원소_조성":  ELEM_COLS,
        "descriptor": DESC_COLS,
        "타깃_물성":  TARGET_COLS,
        "메타":       ["paper.paper_id", "meas.test_mode", "meas.test_temp_C"],
    }
    for group, check_cols in required.items():
        missing = [c for c in check_cols if c not in df.columns]
        status  = "OK" if not missing else f"누락: {missing}"
        print(f"  [{group}] {status}")

    available = [c for c in TARGET_COLS if c in df.columns]
    print("\n[타깃 물성 기초 통계]")
    print(df[available].describe().round(2).to_string())

    mask_ys  = df["meas.YS_MPa"] > YS_KPI       if "meas.YS_MPa"         in df.columns else pd.Series(False, index=df.index)
    mask_el  = df["meas.elongation_pct"] > EL_KPI if "meas.elongation_pct" in df.columns else pd.Series(False, index=df.index)
    mask_bcc = df.get("meas.BCC_fraction_pct", pd.Series(np.nan, index=df.index)) > BCC_KPI

    print("\n[KPI 달성 현황]")
    print(f"  YS > {YS_KPI} MPa              : {mask_ys.sum():>4}행")
    print(f"  Elongation > {EL_KPI}%          : {mask_el.sum():>4}행")
    print(f"  BCC fraction > {BCC_KPI}%       : {mask_bcc.sum():>4}행")
    print(f"  YS+El 동시 충족                 : {(mask_ys & mask_el).sum():>4}행")
    print(f"  YS+El+BCC 동시 충족             : {(mask_ys & mask_el & mask_bcc).sum():>4}행")

    return df


# ══════════════════════════════════════════════════════════════
# 2. SQLite 적재
# ══════════════════════════════════════════════════════════════
def load_to_sqlite(df: pd.DataFrame, db_path: Path) -> sqlite3.Connection:
    print("\n" + "="*55)
    print("  2. SQLite DB 적재")
    print("="*55)

    df_sql = df.copy()
    df_sql.columns = [c.replace(".", "_") for c in df_sql.columns]

    conn = sqlite3.connect(db_path)
    df_sql.to_sql("measurements", conn, if_exists="replace", index=False)
    print(f"  measurements 테이블: {len(df_sql)}행 적재")

    # experiment_log 테이블
    conn.execute("""
        CREATE TABLE IF NOT EXISTS experiment_log (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at        TEXT    DEFAULT (datetime('now')),
            alloy_id          TEXT,
            Ti_at  REAL, Zr_at REAL, Hf_at REAL, V_at  REAL,
            Nb_at  REAL, Ta_at REAL, Cr_at REAL, Mo_at REAL,
            W_at   REAL, Al_at REAL,
            process_note      TEXT,
            YS_MPa            REAL,
            elongation_pct    REAL,
            BCC_fraction_pct  REAL,
            hardness_HV       REAL,
            experiment_status TEXT    DEFAULT 'pending',
            notes             TEXT
        )
    """)
    conn.commit()

    size_kb = db_path.stat().st_size / 1024
    print(f"  experiment_log 테이블 생성")
    print(f"  DB 파일: {db_path.name}  ({size_kb:.1f} KB)")
    print(f"  ✅ SQLite 적재 완료")

    return conn   # 이후 update 함수들에서 재사용


# ══════════════════════════════════════════════════════════════
# 3. DB 값 업데이트
# ══════════════════════════════════════════════════════════════
def _to_python_scalar(val):
        """numpy/pandas 타입 → Python 기본 타입 변환."""
        if val is None:
            return None
        try:
            if pd.isna(val):
                return None
        except (TypeError, ValueError):
            pass
        if isinstance(val, np.bool_):
            return int(val)
        if isinstance(val, np.integer):
            return int(val)
        if isinstance(val, np.floating):
            return float(val)
        return val

def _save_column(conn: sqlite3.Connection, df: pd.DataFrame, col: str) -> int:
    """rowid 기준으로 measurements 테이블의 특정 컬럼 업데이트."""
    cur = conn.cursor()
    updated = 0
    for _, row in df[["_rowid", col]].iterrows():
        val = _to_python_scalar(row[col])
        cur.execute(
            f"UPDATE measurements SET {col} = ? WHERE rowid = ?",
            (val, int(row["_rowid"]))
        )
        updated += cur.rowcount
    conn.commit()
    return updated


def _load_db_df(conn: sqlite3.Connection) -> pd.DataFrame:
    df = pd.read_sql("SELECT rowid AS _rowid, * FROM measurements", conn)
    return df


def update_is_target_met(conn: sqlite3.Connection) -> None:
    print("\n  [3-1] is_target_met 재계산")
    df = _load_db_df(conn)

    mask_ys  = df["meas_YS_MPa"] > YS_KPI
    mask_el  = df["meas_elongation_pct"] > EL_KPI
    mask_bcc = (df.get("meas_BCC_fraction_pct", pd.Series(np.nan, index=df.index)) > BCC_KPI).fillna(False)

    df["meas_is_target_met"] = [int(v) for v in (mask_ys & mask_el & mask_bcc)]

    
    n = _save_column(conn, df, "meas_is_target_met")
    met = int(df["meas_is_target_met"].sum())
    print(f"       is_target_met=1: {met}행  /  =0: {len(df)-met}행  (업데이트 {n}행)")


def update_composition_formula(conn: sqlite3.Connection) -> None:
    print("\n  [3-2] composition_formula 생성")
    df = _load_db_df(conn)

    def make_formula(row):
        parts = []
        for elem, col in zip(ELEMENTS, ELEM_COLS_DB):
            val = row.get(col, 0)
            if pd.notna(val) and val > 0:
                parts.append(f"{elem}{round(val)}")
        return "".join(parts) if parts else None

    df["alloy_composition_formula"] = df.apply(make_formula, axis=1)
    n = _save_column(conn, df, "alloy_composition_formula")
    examples = df["alloy_composition_formula"].dropna().iloc[:3].tolist()
    print(f"       예시: {examples}  (업데이트 {n}행)")


def update_data_split(
    conn: sqlite3.Connection,
    n_clusters: int   = 15,
    train_ratio: float = 0.70,
    val_ratio:   float = 0.15,
    random_state: int  = 42,
) -> None:
    """
    조성 클러스터 기반 train/val/test 분할.
    랜덤 split 금지 — 유사 조성이 train/test에 동시 존재하면 data leakage 발생.
    """
    print("\n  [3-3] data_split (KMeans 클러스터 기반)")
    df = _load_db_df(conn)

    X = df[ELEM_COLS_DB].fillna(0.0).values
    X_scaled = StandardScaler().fit_transform(X)

    kmeans = KMeans(n_clusters=n_clusters, random_state=random_state, n_init=10)
    df["_cluster"] = kmeans.fit_predict(X_scaled)

    cluster_sizes = df.groupby("_cluster").size().sort_values(ascending=False)
    rng = np.random.default_rng(random_state)
    cluster_ids = rng.permutation(cluster_sizes.index.tolist())

    total = len(df)
    train_target = int(total * train_ratio)
    val_target   = int(total * val_ratio)

    cluster_split = {}
    train_count = val_count = 0
    for cid in cluster_ids:
        size = cluster_sizes[cid]
        if train_count < train_target:
            cluster_split[cid] = "train"
            train_count += size
        elif val_count < val_target:
            cluster_split[cid] = "val"
            val_count += size
        else:
            cluster_split[cid] = "test"

    df["meas_data_split"] = df["_cluster"].map(cluster_split)
    n = _save_column(conn, df, "meas_data_split")

    counts = df["meas_data_split"].value_counts()
    result = "  /  ".join([f"{s}: {c}행({c/total:.0%})" for s, c in counts.items()])
    print(f"       {result}  (업데이트 {n}행)")


def update_uncertainty_score(conn: sqlite3.Connection) -> None:
    """NGBoost 연결 전 임시값 1.0 (최대 불확실도) 세팅."""
    print("\n  [3-4] uncertainty_score 초기값 세팅 (임시 1.0)")
    df = _load_db_df(conn)
    df["meas_uncertainty_score"] = 1.0
    n = _save_column(conn, df, "meas_uncertainty_score")
    print(f"       전체 {n}행 → 1.0 세팅  (NGBoost 연결 후 실제값으로 교체)")


def recreate_view(conn: sqlite3.Connection) -> None:
    """v_ml_features 뷰 재생성 — 업데이트된 컬럼 모두 반영."""
    print("\n  [3-5] v_ml_features 뷰 재생성")

    elem_sql    = ", ".join(ELEM_COLS_DB)
    desc_sql    = ", ".join([
        "alloy_VEC", "alloy_delta_pct", "alloy_dH_mix_kJ",
        "alloy_dS_mix_J", "alloy_Tm_mix_K", "alloy_density_calc_gcm3",
        "alloy_Omega", "alloy_delta_chi", "alloy_Lambda", "alloy_G_mean_GPa",
    ])
    process_sql = ", ".join([
        "meas_test_temp_C",
        "sample_anneal_temp_C",
        "sample_rolling_reduction_pct",
    ])
    target_sql  = ", ".join([
        "meas_YS_MPa", "meas_elongation_pct",
        "meas_BCC_fraction_pct", "meas_hardness_HV",
    ])
    label_sql   = ", ".join([
        "meas_is_BCC_single", "meas_is_target_met",
        "meas_bcc_phase_label", "meas_data_split",
        "meas_experiment_status", "meas_active_learning_flag",
        "meas_uncertainty_score",
    ])

    conn.execute("DROP VIEW IF EXISTS v_ml_features")
    conn.execute(f"""
        CREATE VIEW v_ml_features AS
        SELECT
            rowid                     AS row_id,
            paper_paper_id,
            paper_source_ref,
            alloy_composition_formula,
            {elem_sql},
            {desc_sql},
            {process_sql},
            {target_sql},
            {label_sql}
        FROM measurements
    """)
    conn.commit()

    n = pd.read_sql("SELECT COUNT(*) AS n FROM v_ml_features", conn)["n"].iloc[0]
    print(f"       v_ml_features: {n}행  ✅")


def run_db_update(conn: sqlite3.Connection) -> None:
    print("\n" + "="*55)
    print("  3. DB 값 업데이트")
    print("="*55)
    update_is_target_met(conn)
    update_composition_formula(conn)
    update_data_split(conn)
    update_uncertainty_score(conn)
    recreate_view(conn)
    print("\n  ✅ DB 업데이트 완료")


# ══════════════════════════════════════════════════════════════
# 4. ML 학습셋 구성
# ══════════════════════════════════════════════════════════════
def build_ml_dataset(
    df: pd.DataFrame,
    target_col: str,
    elem_cols: list,
    desc_cols: list,
    process_cols: list = None,
    filter_rt_only: bool = True,
    filter_tensile: bool = True,
) -> tuple:
    """
    ■ 학습셋에서 제외하는 데이터 및 이유
    ─────────────────────────────────────────────────────
    [제외 1] micropillar_compression (나노 필라 압축 시험)
      - 머리카락 굵기의 1/1000 수준인 나노 기둥을 눌러서 측정한 값
      - 물체가 아주 작아지면 원래보다 5~10배 강해지는 '크기 효과' 발생
      - 우리가 만들 실제 합금 덩어리(벌크)와 전혀 다른 조건
      - 예) P019 NbMoTaW: 나노 필라 YS 5000~10000 MPa → 벌크에서는 1000~1500 MPa 수준

    [제외 2] experiment_status = 'computed' (DFT 컴퓨터 계산값)
      - 실제로 합금을 만들어서 측정한 게 아니라 컴퓨터 시뮬레이션 이론값
      - 현실에서는 이론값보다 훨씬 낮게 나오는 게 일반적
      - 예) P034 TiZrVNb: 계산 YS 7130 MPa → 실험에서는 500~800 MPa 예상

    [제외 3] dynamic_compression (동적 압축 시험)
      - 총알처럼 빠른 속도로 충격을 가해서 측정한 값 (고변형률 시험)
      - 우리가 예측하려는 일반적인 인장/압축 시험과 완전히 다른 조건
      - 같은 조성이라도 동적 YS는 정적 YS보다 2~3배 높게 나옴

    → 위 3가지가 섞이면 같은 조성에서 수치가 5~10배 차이나
      모델이 패턴을 학습하지 못하고 R²가 크게 떨어짐
    ─────────────────────────────────────────────────────
    """
    if process_cols is None:
        process_cols = []

    df_work = df.copy()

    if target_col not in df_work.columns:
        raise ValueError(f"{target_col} 컬럼 없음")
    df_work = df_work[df_work[target_col].notnull()].copy()

    # [제외 2] 컴퓨터 계산값(DFT) 제거 — 실험값이 아님
    if "meas.experiment_status" in df_work.columns:
        ok = df_work["meas.experiment_status"] != "computed"
        n_removed = (~ok).sum()
        if n_removed > 0:
            print(f"    제외(computed): {n_removed}행 — DFT 계산값, 실험값 아님")
        df_work = df_work[ok].copy()

    if filter_rt_only and "meas.test_temp_C" in df_work.columns:
        ok = df_work["meas.test_temp_C"].isnull() | (df_work["meas.test_temp_C"] <= 100)
        df_work = df_work[ok].copy()

    if filter_tensile and "meas.test_mode" in df_work.columns:
        # [제외 1] 나노 필라: 크기 효과로 벌크 대비 5~10배 높은 YS → 제외
        # [제외 3] 동적 압축: 충격 시험이라 정적 시험과 비교 불가 → 제외
        VALID_MODES = ["tensile", "compression"]
        ok = df_work["meas.test_mode"].isnull() | (
            df_work["meas.test_mode"].isin(VALID_MODES)
        )
        n_removed = (~ok).sum()
        if n_removed > 0:
            removed_modes = df_work.loc[~ok, "meas.test_mode"].value_counts().to_dict()
            print(f"    제외(시험방식): {n_removed}행 — {removed_modes}")
        df_work = df_work[ok].copy()

    feature_cols = [c for c in elem_cols + desc_cols + process_cols
                    if c in df_work.columns]
    X    = df_work[feature_cols].copy()
    y    = df_work[target_col].copy()
    meta = df_work[["paper.paper_id", "paper.source_ref"]].copy() \
           if "paper.paper_id" in df_work.columns else pd.DataFrame()

    for c in elem_cols:
        if c in X.columns:
            X[c] = X[c].fillna(0.0)
    for c in desc_cols:
        if c in X.columns and X[c].isnull().any():
            X[c] = X[c].fillna(X[c].median())
    if "meas.test_temp_C" in X.columns:
        X["meas.test_temp_C"] = X["meas.test_temp_C"].fillna(25.0)

    for c in X.columns:
        mu, sigma = X[c].mean(), X[c].std()
        if sigma > 0:
            X[c] = X[c].clip(mu - 3 * sigma, mu + 3 * sigma)

    return (
        X.reset_index(drop=True),
        y.reset_index(drop=True),
        meta.reset_index(drop=True),
        feature_cols,
    )


def prepare_ml_datasets(df: pd.DataFrame) -> dict:
    print("\n" + "="*55)
    print("  4. ML 학습셋 구성")
    print("="*55)

    elem_cols = [c for c in ELEM_COLS if c in df.columns]
    desc_cols = [c for c in DESC_COLS if c in df.columns]

    print("\n[피처 결측률]")
    for c in elem_cols + desc_cols:
        rate = df[c].isnull().mean() * 100
        bar  = "#" * int(rate / 5)
        print(f"  {c:<35} {rate:5.1f}%  {bar}")

    # filter_rt_only=True: test_temp_C ≤ 100°C 또는 결측(RT로 간주)만 포함.
    # 고온 데이터 혼재 시 같은 조성이라도 YS가 3~10배 차이나
    # 모델이 조성이 아닌 온도에만 의존하게 되어 CV R²가 붕괴됨.
    X_ys, y_ys, meta_ys, feat_ys = build_ml_dataset(
        df, "meas.YS_MPa", elem_cols, desc_cols,
        process_cols=PROCESS_COLS, filter_rt_only=True, filter_tensile=True,
    )
    print(f"\nYS 데이터셋    : {X_ys.shape[0]}행 x {X_ys.shape[1]}피처")
    print(f"  YS 범위      : {y_ys.min():.1f} ~ {y_ys.max():.1f} MPa  (중위수: {y_ys.median():.1f})")

    X_el, y_el, meta_el, feat_el = build_ml_dataset(
        df, "meas.elongation_pct", elem_cols, desc_cols,
        process_cols=PROCESS_COLS, filter_rt_only=True, filter_tensile=True,
    )
    print(f"\n연신율 데이터셋: {X_el.shape[0]}행 x {X_el.shape[1]}피처")
    print(f"  연신율 범위  : {y_el.min():.1f} ~ {y_el.max():.1f} %  (중위수: {y_el.median():.1f})")

    # ── 조성 클러스터 기반 GroupKFold용 groups 생성 ──────────────────
    # 유사 조성(같은 논문의 series 조성 등)이 train/val에 동시 존재하면
    # CV R²가 실제보다 높게 나오는 leakage 발생.
    # 원소 분율 공간에서 KMeans로 클러스터링 → 같은 클러스터 = 같은 그룹.
    # n_clusters: 데이터 n행 기준 그룹당 ~10행이 되도록 설정.
    #   YS  205행 → 20클러스터 (그룹당 ~10행)
    #   El  122행 → 12클러스터 (그룹당 ~10행)
    from sklearn.cluster import KMeans

    at_cols_ys = [c for c in X_ys.columns if c.endswith("_at")]
    at_cols_el = [c for c in X_el.columns if c.endswith("_at")]

    def make_groups(X: pd.DataFrame, at_cols: list, n_clusters: int) -> np.ndarray:
        n_clusters = min(n_clusters, len(X))   # 데이터보다 클러스터가 많으면 안 됨
        km = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        return km.fit_predict(X[at_cols].fillna(0))

    groups_ys = make_groups(X_ys, at_cols_ys, n_clusters=max(5, len(X_ys) // 10))
    groups_el = make_groups(X_el, at_cols_el, n_clusters=max(5, len(X_el) // 10))

    print(f"\n[GroupKFold 클러스터]")
    print(f"  YS  groups: {len(set(groups_ys))}개 클러스터 ({len(X_ys)}행)")
    print(f"  El  groups: {len(set(groups_el))}개 클러스터 ({len(X_el)}행)")
    # ─────────────────────────────────────────────────────────────────

    ml_data = {
        "X_ys": X_ys, "y_ys": y_ys, "meta_ys": meta_ys, "feat_ys": feat_ys,
        "X_el": X_el, "y_el": y_el, "meta_el": meta_el, "feat_el": feat_el,
        "ELEM_COLS": elem_cols, "DESC_COLS": desc_cols,
        "groups_ys": groups_ys,   # ← GroupKFold용 (train_model.py가 읽음)
        "groups_el": groups_el,   # ← GroupKFold용
    }

    cache_pkl = CACHE_DIR / "ml_data.pkl"
    with open(cache_pkl, "wb") as f:
        pickle.dump(ml_data, f)
    print(f"\n  ✅ ML 캐시 저장: {cache_pkl.name}")
    return ml_data


# ══════════════════════════════════════════════════════════════
# 5. EDA 시각화
# ══════════════════════════════════════════════════════════════
def plot_missing_rate(df, elem_cols, desc_cols):
    fig, axes = plt.subplots(1, 2, figsize=(14, 4))
    miss_elem = df[elem_cols].isnull().mean() * 100
    axes[0].barh([c.replace("alloy.","").replace("_at","") for c in elem_cols],
                 miss_elem.values, color="steelblue")
    axes[0].set_xlabel("Missing Rate (%)")
    axes[0].set_title("Element Composition — Missing Rate")
    axes[0].axvline(20, color="red", linestyle="--", alpha=0.6, label="20%")
    axes[0].legend()
    if desc_cols:
        miss_desc = df[desc_cols].isnull().mean() * 100
        axes[1].barh([c.replace("alloy.","") for c in desc_cols],
                     miss_desc.values, color="darkorange")
        axes[1].set_xlabel("Missing Rate (%)")
        axes[1].set_title("Descriptors — Missing Rate")
        axes[1].axvline(20, color="red", linestyle="--", alpha=0.6)
    plt.tight_layout()
    out = CACHE_DIR / "missing_rate.png"
    plt.savefig(out, dpi=120, bbox_inches="tight"); plt.close()
    print(f"  저장: {out.name}")


def plot_element_distribution(df, elem_cols):
    fig, axes = plt.subplots(2, 5, figsize=(16, 6))
    axes = axes.flatten()
    for i, col_name in enumerate(elem_cols):
        elem = col_name.replace("alloy.","").replace("_at","")
        data = df[col_name].dropna()
        axes[i].hist(data, bins=25, color="steelblue", edgecolor="white", alpha=0.8)
        axes[i].set_title(f"{elem}  (n={len(data)})")
        axes[i].set_xlabel("at%"); axes[i].set_ylabel("Count")
    for j in range(i+1, len(axes)):
        axes[j].set_visible(False)
    plt.suptitle("Element Composition Distribution", fontsize=13, y=1.01)
    plt.tight_layout()
    out = CACHE_DIR / "element_distribution.png"
    plt.savefig(out, dpi=120, bbox_inches="tight"); plt.close()
    print(f"  저장: {out.name}")


def plot_descriptor_distribution(df, desc_cols):
    ncols = 4
    nrows = (len(desc_cols) + ncols - 1) // ncols
    fig, axes = plt.subplots(nrows, ncols, figsize=(16, 4*nrows))
    axes = axes.flatten()
    for i, col_name in enumerate(desc_cols):
        data  = df[col_name].dropna()
        label = col_name.replace("alloy.","")
        axes[i].hist(data, bins=25, color="darkorange", edgecolor="white", alpha=0.8)
        axes[i].set_title(f"{label}  (n={len(data)})")
        axes[i].set_xlabel(label); axes[i].set_ylabel("Count")
        if col_name in BCC_RULES:
            lo, hi = BCC_RULES[col_name]
            if lo is not None:
                axes[i].axvline(lo, color="red", linestyle="--", lw=1.5, label=f"min={lo}")
            if hi is not None:
                axes[i].axvline(hi, color="red", linestyle="--", lw=1.5, label=f"max={hi}")
            axes[i].legend(fontsize=7)
    for j in range(i+1, len(axes)):
        axes[j].set_visible(False)
    plt.suptitle("Descriptor Distributions with BCC Phase Stability Rules", fontsize=13, y=1.01)
    plt.tight_layout()
    out = CACHE_DIR / "descriptor_distribution.png"
    plt.savefig(out, dpi=120, bbox_inches="tight"); plt.close()
    print(f"  저장: {out.name}")


def plot_target_distribution(y_ys, y_el):
    fig, axes = plt.subplots(1, 2, figsize=(12, 4))
    axes[0].hist(y_ys, bins=30, color="steelblue", edgecolor="white", alpha=0.85)
    axes[0].axvline(1000, color="red", linestyle="--", lw=2, label="KPI: 1000 MPa")
    axes[0].set_title(f"YS Distribution  (n={len(y_ys)})")
    axes[0].set_xlabel("YS (MPa)"); axes[0].set_ylabel("Count"); axes[0].legend()
    axes[1].hist(y_el, bins=30, color="darkorange", edgecolor="white", alpha=0.85)
    axes[1].axvline(30, color="red", linestyle="--", lw=2, label="KPI: 30%")
    axes[1].set_title(f"Elongation Distribution  (n={len(y_el)})")
    axes[1].set_xlabel("Elongation (%)"); axes[1].set_ylabel("Count"); axes[1].legend()
    plt.tight_layout()
    out = CACHE_DIR / "target_distribution.png"
    plt.savefig(out, dpi=120, bbox_inches="tight"); plt.close()
    print(f"  저장: {out.name}")


def plot_ys_correlation(X_ys, y_ys):
    if len(y_ys) < 10:
        return
    X_corr = X_ys.copy()
    X_corr["YS_MPa"] = y_ys.values
    corr = X_corr.corr()["YS_MPa"].drop("YS_MPa").sort_values(key=abs, ascending=False)
    colors = ["steelblue" if v > 0 else "tomato" for v in corr.values]
    plt.figure(figsize=(8, 5))
    plt.barh([c.replace("alloy.","").replace("meas.","") for c in corr.index],
             corr.values, color=colors)
    plt.axvline(0, color="black", lw=0.8)
    plt.title("Pearson Correlation with YS_MPa")
    plt.xlabel("Correlation coefficient")
    plt.tight_layout()
    out = CACHE_DIR / "ys_correlation.png"
    plt.savefig(out, dpi=120, bbox_inches="tight"); plt.close()
    print(f"  저장: {out.name}")
    print("\n  YS 상관관계 상위 8개:")
    for c, v in corr.head(8).items():
        print(f"    {c:<35} {v:+.3f}")


def run_eda(df, ml_data):
    print("\n" + "="*55)
    print("  5. EDA 시각화")
    print("="*55)
    ec = [c for c in ELEM_COLS if c in df.columns]
    dc = [c for c in DESC_COLS if c in df.columns]
    plot_missing_rate(df, ec, dc)
    plot_element_distribution(df, ec)
    if dc:
        plot_descriptor_distribution(df, dc)
    plot_target_distribution(ml_data["y_ys"], ml_data["y_el"])
    plot_ys_correlation(ml_data["X_ys"], ml_data["y_ys"])


# ══════════════════════════════════════════════════════════════
# 6. 수치 필터링 쿼리 테스트
# ══════════════════════════════════════════════════════════════
def query_similar_alloys(db_path, ys_min=800, el_min=10, bcc_min=70, top_n=10):
    conditions, params = [], []
    if ys_min  is not None: conditions.append("meas_YS_MPa >= ?");           params.append(ys_min)
    if el_min  is not None: conditions.append("meas_elongation_pct >= ?");    params.append(el_min)
    if bcc_min is not None: conditions.append("(meas_BCC_fraction_pct >= ? OR meas_BCC_fraction_pct IS NULL)"); params.append(bcc_min)
    where    = " AND ".join(conditions) if conditions else "1=1"
    elem_sql = ", ".join(ELEM_COLS_DB)
    query = f"""
    SELECT paper_paper_id, paper_source_ref, {elem_sql},
           alloy_VEC, alloy_delta_pct,
           meas_YS_MPa, meas_elongation_pct, meas_BCC_fraction_pct
    FROM measurements WHERE {where}
    ORDER BY meas_YS_MPa DESC LIMIT ?
    """
    params.append(top_n)
    conn   = sqlite3.connect(db_path)
    result = pd.read_sql(query, conn, params=params)
    conn.close()
    return result


def run_filter_tests(db_path):
    print("\n" + "="*55)
    print("  6. 수치 필터링 쿼리 테스트")
    print("="*55)
    tests = [
        dict(ys_min=800,  el_min=10, bcc_min=70, label="느슨한 조건"),
        dict(ys_min=1000, el_min=20, bcc_min=80, label="KPI 근접"),
        dict(ys_min=1000, el_min=30, bcc_min=90, label="KPI 완전 달성"),
    ]
    for t in tests:
        label  = t.pop("label")
        result = query_similar_alloys(db_path, **t)
        print(f"\n  [{label}]  -> {len(result)}건")
        if len(result) > 0:
            show = [c for c in ["meas_YS_MPa","meas_elongation_pct","meas_BCC_fraction_pct"] if c in result.columns]
            print(result[show].to_string(index=True))


# ══════════════════════════════════════════════════════════════
# 최종 요약
# ══════════════════════════════════════════════════════════════
def print_summary(df, ml_data, conn):
    print("\n" + "="*55)
    print("DB 상태 리포트")
    print("="*55)

    n_papers = df["paper.paper_id"].nunique() if "paper.paper_id" in df.columns else "N/A"
    print(f"  전체 행 수   : {len(df):>5}행")
    print(f"  논문 수      : {n_papers:>5}편")

    print("\n  [타깃 물성 유효 샘플]")
    for col_name in TARGET_COLS:
        if col_name in df.columns:
            n = df[col_name].notnull().sum()
            print(f"  {col_name:<32}: {n:>4}행")

    print("\n  [ML 학습셋 크기]")
    print(f"  YS 회귀 데이터셋     : {len(ml_data['y_ys']):>5}행 x {ml_data['X_ys'].shape[1]:>2} 피처")
    print(f"  연신율 회귀 데이터셋 : {len(ml_data['y_el']):>5}행 x {ml_data['X_el'].shape[1]:>2} 피처")

    print("\n  [data_split 분포]")
    splits = pd.read_sql("SELECT meas_data_split, COUNT(*) as n FROM measurements GROUP BY meas_data_split", conn)
    for _, row in splits.iterrows():
        print(f"  {str(row['meas_data_split']):<10}: {row['n']:>4}행")

    print("\n  [is_target_met]")
    n_met     = pd.read_sql("SELECT COUNT(*) as n FROM measurements WHERE meas_is_target_met = 1", conn)["n"].iloc[0]
    n_not_met = pd.read_sql("SELECT COUNT(*) as n FROM measurements WHERE meas_is_target_met = 0 OR meas_is_target_met IS NULL", conn)["n"].iloc[0]
    print(f"  =1: {n_met:>4}행")
    print(f"  =0: {n_not_met:>4}행")    

    print("\n  [생성 파일]")
    print("  data/hea_designer.db      (measurements + v_ml_features + experiment_log)")
    print("  data/cache/ml_data.pkl    (ML 학습셋)")
    print("  data/cache/*.png          (EDA 시각화 5종)")


# ══════════════════════════════════════════════════════════════
# main
# ══════════════════════════════════════════════════════════════
def main():
    print("HEA Designer — DB 적재 + 전처리")
    print(f"ROOT: {ROOT}")

    df   = load_and_explore(CSV_PATH)
    conn = load_to_sqlite(df, DB_PATH)
    run_db_update(conn)
    ml_data = prepare_ml_datasets(df)
    run_eda(df, ml_data)
    run_filter_tests(DB_PATH)
    print_summary(df, ml_data, conn)
    conn.close()


if __name__ == "__main__":
    main()