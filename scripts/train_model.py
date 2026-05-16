"""
train_model.py
====================
HEA Designer — 회귀 모델 학습 + 평가 + SHAP

[수정 이력]
  v2 (2026-05-16):
    Fix 1. 이상치 중복 제거 제거 — db_setup.py에서 이미 ±3σ 클리핑하므로 여기서는 스킵
    Fix 2. 연신율 log 변환 — skewness 해소 (학습: log1p, 예측 후: expm1 역변환)
    Fix 3. GroupKFold 교차검증 — ml_data.pkl의 data_split 컬럼 사용 (leakage 방지)
    Fix 4. 모델 버전 관리 — 날짜 + R² 포함 파일명, model_report.json 누적 히스토리

실행:
    python scripts/train_model.py

입력:
    data/cache/ml_data.pkl

출력:
    models/ys_model_YYYYMMDD_r2_XXXX.pkl      <- YS 예측 모델 (버전 포함)
    models/el_model_YYYYMMDD_r2_XXXX.pkl      <- 연신율 예측 모델 (버전 포함)
    models/ys_model_latest.pkl                <- 최신 YS 모델 심볼릭 복사본
    models/el_model_latest.pkl                <- 최신 연신율 모델 심볼릭 복사본
    models/model_report.json                  <- 누적 학습 히스토리 (append 방식)
    data/cache/shap_ys.png
    data/cache/shap_ys_beeswarm.png
    data/cache/shap_el.png
    data/cache/shap_el_beeswarm.png
    data/cache/pred_vs_true.png
"""

import json
import pickle
import shutil
import warnings
from datetime import datetime, timezone
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import shap
from sklearn.model_selection import GroupKFold
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error
from sklearn.preprocessing import RobustScaler
from xgboost import XGBRegressor

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────
# 경로 설정
# ─────────────────────────────────────────────────────────────
ROOT      = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "data" / "cache"
MODEL_DIR = ROOT / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

PKL_PATH    = CACHE_DIR / "ml_data.pkl"
REPORT_PATH = MODEL_DIR / "model_report.json"

# "latest" 심볼릭 경로 (항상 최신 모델을 가리킴)
YS_MODEL_LATEST = MODEL_DIR / "ys_model_latest.pkl"
EL_MODEL_LATEST = MODEL_DIR / "el_model_latest.pkl"


# ══════════════════════════════════════════════════════════════
# 1. 데이터 로드
# ══════════════════════════════════════════════════════════════
def load_data() -> dict:
    print("\n" + "="*55)
    print("  1. 데이터 로드")
    print("="*55)
    assert PKL_PATH.exists(), (
        f"ml_data.pkl 없음: {PKL_PATH}\n먼저 db_setup.py를 실행하세요."
    )
    with open(PKL_PATH, "rb") as f:
        d = pickle.load(f)
    print(f"  YS 데이터셋    : {d['X_ys'].shape[0]}행 x {d['X_ys'].shape[1]}피처")
    print(f"  연신율 데이터셋: {d['X_el'].shape[0]}행 x {d['X_el'].shape[1]}피처")
    print(f"  피처 목록      : {d['feat_ys']}")

    # data_split 컬럼 존재 여부 확인
    # Fix 3: db_setup.py가 클러스터 기반으로 data_split을 부여했는지 체크
    for key in ("groups_ys", "groups_el"):
        if key in d:
            n_groups = len(set(d[key]))
            print(f"  {key}: {n_groups}개 그룹 (GroupKFold용)")
        else:
            print(f"  ⚠️  {key} 없음 — 랜덤 KFold로 폴백 (leakage 가능)")
    return d


# ══════════════════════════════════════════════════════════════
# Fix 1: 이상치 중복 제거 → 완전 제거
# ══════════════════════════════════════════════════════════════
# db_setup.py에서 이미 ±3σ 클리핑을 수행하므로
# 여기서 추가로 IQR 이상치 제거를 하면 중복 필터링이 발생함.
# → remove_outliers_iqr() 함수 자체를 삭제.
# 만약 db_setup에서 클리핑을 제거한 경우에는 이 주석을 지우고
# 아래 함수를 복구하면 됨.


# ══════════════════════════════════════════════════════════════
# 2. 모델 정의
# ══════════════════════════════════════════════════════════════
def get_model() -> XGBRegressor:
    """
    XGBoost 회귀 모델.
    샘플 수가 적으므로 과적합 방지를 위해 보수적 하이퍼파라미터 사용.
    """
    return XGBRegressor(
        n_estimators=400,
        learning_rate=0.05,
        max_depth=4,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=1.0,
        min_child_weight=3,
        random_state=42,
        n_jobs=-1,
        verbosity=0,
    )


# ══════════════════════════════════════════════════════════════
# Fix 2: log 변환 헬퍼
# ══════════════════════════════════════════════════════════════
# 연신율 분포가 skewness 1.37로 우편향 — 낮은 값 예측 편향 발생.
# log1p 변환으로 분포를 정규화한 뒤 학습, 예측 후 expm1로 역변환.
# YS는 skewness가 낮으므로 변환 불필요.

def log_transform(y: pd.Series, label: str) -> tuple[pd.Series, bool]:
    """skewness > 0.75이면 log1p 변환 적용."""
    skew = float(y.skew())
    if skew > 0.75:
        print(f"  [{label}] skewness={skew:.2f} > 0.75 → log1p 변환 적용")
        return np.log1p(y), True
    else:
        print(f"  [{label}] skewness={skew:.2f} ≤ 0.75 → 변환 없음")
        return y, False


def inverse_transform(y_pred: np.ndarray, is_log: bool) -> np.ndarray:
    """log1p 변환이 적용된 경우 expm1로 역변환."""
    if is_log:
        return np.expm1(y_pred)
    return y_pred


# ══════════════════════════════════════════════════════════════
# Fix 3: GroupKFold 교차검증 (leakage 방지)
# ══════════════════════════════════════════════════════════════
def cross_validate_model(
    X: pd.DataFrame,
    y: pd.Series,
    label: str,
    groups: np.ndarray | None,
    is_log: bool,
) -> dict:
    """
    Fix 3: 랜덤 KFold → GroupKFold 교체.

    db_setup.py에서 조성 클러스터 기반으로 data_split 컬럼을 부여함.
    유사 조성(같은 클러스터)이 train/val에 동시 존재하면 R²가
    실제보다 높게 나오는 leakage가 발생 → GroupKFold로 클러스터 단위 분리.

    groups가 None이면 (db_setup에서 클러스터를 부여하지 않은 경우)
    index 기반 더미 그룹으로 폴백하고 경고를 표시함.
    """
    print(f"\n  [{label}] GroupKFold Cross Validation (n_splits=5)")

    # groups 없으면 폴백
    if groups is None or len(set(groups)) < 5:
        print(f"  ⚠️  groups 부족 — 각 샘플을 독립 그룹으로 처리 (leakage 가능)")
        groups = np.arange(len(X))  # 각 샘플 = 독립 그룹

    gkf = GroupKFold(n_splits=5)

    r2_scores, mae_scores, rmse_scores = [], [], []

    for fold, (train_idx, val_idx) in enumerate(gkf.split(X, y, groups=groups), 1):
        X_tr, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_tr, y_val = y.iloc[train_idx], y.iloc[val_idx]

        # log 변환된 y_tr로 학습, y_val은 원본 스케일로 평가
        y_tr_fit = np.log1p(y_tr) if is_log else y_tr

        scaler = RobustScaler()
        X_tr_s  = scaler.fit_transform(X_tr)
        X_val_s = scaler.transform(X_val)

        model = get_model()
        model.fit(X_tr_s, y_tr_fit,
                  eval_set=[(X_val_s, np.log1p(y_val) if is_log else y_val)],
                  verbose=False)

        # 예측 후 역변환 → 원본 스케일로 지표 계산
        pred_raw = model.predict(X_val_s)
        pred     = inverse_transform(pred_raw, is_log)
        pred     = np.clip(pred, 0, None)  # 음수 방지

        r2_scores.append(r2_score(y_val, pred))
        mae_scores.append(mean_absolute_error(y_val, pred))
        rmse_scores.append(np.sqrt(mean_squared_error(y_val, pred)))

        print(f"    Fold {fold}: R²={r2_scores[-1]:.3f}  MAE={mae_scores[-1]:.1f}  RMSE={rmse_scores[-1]:.1f}")

    cv_result = {
        "R2_mean":   round(float(np.mean(r2_scores)),  3),
        "R2_std":    round(float(np.std(r2_scores)),   3),
        "MAE_mean":  round(float(np.mean(mae_scores)), 2),
        "MAE_std":   round(float(np.std(mae_scores)),  2),
        "RMSE_mean": round(float(np.mean(rmse_scores)),2),
        "RMSE_std":  round(float(np.std(rmse_scores)), 2),
        "cv_method": "GroupKFold" if groups is not None else "FallbackKFold",
        "log_transform": is_log,
    }

    print(f"\n  CV 결과 ({label})")
    print(f"    R²   : {cv_result['R2_mean']:.3f} ± {cv_result['R2_std']:.3f}  (목표: > 0.80)")
    print(f"    MAE  : {cv_result['MAE_mean']:.2f} ± {cv_result['MAE_std']:.2f}")
    print(f"    RMSE : {cv_result['RMSE_mean']:.2f} ± {cv_result['RMSE_std']:.2f}")
    print(f"    CV방법: {cv_result['cv_method']}  |  log변환: {is_log}")

    kpi_ok = "✅" if cv_result["R2_mean"] >= 0.80 else "⚠️  R² < 0.80 — 데이터 추가 필요"
    print(f"    KPI  : {kpi_ok}")

    return cv_result


# ══════════════════════════════════════════════════════════════
# 3. 최종 모델 학습 (전체 데이터)
# ══════════════════════════════════════════════════════════════
def train_final_model(
    X: pd.DataFrame,
    y: pd.Series,
    is_log: bool,
    label: str,
) -> tuple:
    """
    전체 데이터로 최종 모델 학습.
    is_log=True이면 log1p 변환 후 학습.
    번들에 is_log 플래그 포함 → predict 시 자동 역변환.
    """
    print(f"\n  [{label}] 전체 데이터 최종 학습")

    scaler = RobustScaler()
    X_scaled = scaler.fit_transform(X)

    y_fit = np.log1p(y) if is_log else y

    model = get_model()
    model.fit(X_scaled, y_fit, verbose=False)

    # 전체 데이터 재예측 (원본 스케일, 참고용)
    pred_raw = model.predict(X_scaled)
    pred     = inverse_transform(pred_raw, is_log)
    pred     = np.clip(pred, 0, None)

    r2   = r2_score(y, pred)
    mae  = mean_absolute_error(y, pred)
    rmse = np.sqrt(mean_squared_error(y, pred))
    print(f"    Train R²={r2:.3f}  MAE={mae:.1f}  RMSE={rmse:.1f}  (train score, 참고용)")

    # feature importance
    fi = pd.Series(model.feature_importances_, index=X.columns)
    fi = fi.sort_values(ascending=False)
    print(f"\n  Feature Importance 상위 8:")
    for feat, val in fi.head(8).items():
        bar = "#" * int(val * 50)
        print(f"    {feat:<35} {val:.4f}  {bar}")

    return model, scaler, fi, r2


# ══════════════════════════════════════════════════════════════
# Fix 4: 버전 관리 — 날짜 + R² 포함 파일명, 히스토리 누적
# ══════════════════════════════════════════════════════════════
def save_model_versioned(
    model,
    scaler,
    features: list,
    label: str,
    is_log: bool,
    r2: float,
    model_type: str,       # "ys" 또는 "el"
    latest_path: Path,
) -> Path:
    """
    Fix 4: 재학습 시 기존 파일을 덮어쓰지 않도록 날짜 + R² 포함 파일명으로 저장.
    예) ys_model_20260516_r2_0823.pkl

    동시에 latest 경로에 복사본을 유지하여 다른 스크립트가
    항상 최신 모델을 일관된 경로로 참조할 수 있게 함.
    """
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    r2_str   = f"{r2:.4f}".replace(".", "")[:6]   # 예: "0.8234" → "082340" → "08234"
    r2_str   = f"{r2:.4f}".replace(".", "")[1:5]  # 소수점 4자리만, 예: "8234"

    fname    = f"{model_type}_model_{date_str}_r2_{r2_str}.pkl"
    save_path = MODEL_DIR / fname

    bundle = {
        "model":    model,
        "scaler":   scaler,
        "features": features,
        "label":    label,
        "is_log":   is_log,    # Fix 2: 역변환 여부 플래그
        "train_r2": round(r2, 4),
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(save_path, "wb") as f:
        pickle.dump(bundle, f)
    print(f"  ✅ 저장 (버전): {save_path.name}")

    # latest 복사 — 다른 스크립트에서 항상 최신 모델 참조 가능
    shutil.copy2(save_path, latest_path)
    print(f"  ✅ latest 갱신: {latest_path.name}")

    return save_path


def update_report_history(cv_ys: dict, cv_el: dict, n_ys: int, n_el: int,
                          fi_ys, fi_el, ys_path: Path, el_path: Path) -> None:
    """
    Fix 4: model_report.json을 덮어쓰지 않고 히스토리에 누적.
    최신 실행 결과가 "runs" 리스트의 앞에 추가됨.
    """
    new_run = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ys_model_file": ys_path.name,
        "el_model_file": el_path.name,
        "YS_model": {
            "cv": cv_ys,
            "n_train": n_ys,
            "feature_importance": {
                k: round(float(v), 5)
                for k, v in fi_ys.head(18).items()
            },
        },
        "El_model": {
            "cv": cv_el,
            "n_train": n_el,
            "feature_importance": {
                k: round(float(v), 5)
                for k, v in fi_el.head(18).items()
            },
        },
    }

    # 기존 히스토리 로드 (없으면 빈 구조 생성)
    if REPORT_PATH.exists():
        try:
            existing = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
        except Exception:
            existing = {"runs": []}
    else:
        existing = {"runs": []}

    existing["runs"].insert(0, new_run)          # 최신 실행을 앞에 추가
    existing["latest"] = new_run                 # 빠른 참조용

    REPORT_PATH.write_text(
        json.dumps(existing, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )
    print(f"  ✅ 리포트 히스토리 누적: {REPORT_PATH.name} (총 {len(existing['runs'])}회)")


# ══════════════════════════════════════════════════════════════
# 4. SHAP 분석
# ══════════════════════════════════════════════════════════════
def plot_shap(
    model: XGBRegressor,
    scaler: RobustScaler,
    X: pd.DataFrame,
    label: str,
    is_log: bool,
    save_path: Path,
) -> None:
    """
    SHAP 분석.
    log 변환 모델은 log 스케일 SHAP을 그리되, 제목에 '(log scale)' 표시.
    """
    print(f"\n  [{label}] SHAP 분석")

    X_scaled = scaler.transform(X)
    X_scaled_df = pd.DataFrame(X_scaled, columns=X.columns)

    explainer   = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_scaled_df)

    log_note = " (log scale)" if is_log else ""

    # SHAP bar summary
    plt.figure(figsize=(9, 6))
    shap.summary_plot(
        shap_values, X_scaled_df,
        plot_type="bar", show=False, max_display=15,
    )
    plt.title(f"SHAP Feature Importance — {label}{log_note}", fontsize=12, pad=10)
    plt.tight_layout()
    plt.savefig(save_path, dpi=130, bbox_inches="tight")
    plt.close()
    print(f"  저장: {save_path.name}")

    # SHAP beeswarm
    beeswarm_path = save_path.parent / save_path.name.replace(".png", "_beeswarm.png")
    plt.figure(figsize=(9, 6))
    shap.summary_plot(shap_values, X_scaled_df, show=False, max_display=15)
    plt.title(f"SHAP Beeswarm — {label}{log_note}", fontsize=12, pad=10)
    plt.tight_layout()
    plt.savefig(beeswarm_path, dpi=130, bbox_inches="tight")
    plt.close()
    print(f"  저장: {beeswarm_path.name}")


# ══════════════════════════════════════════════════════════════
# 5. 예측 vs 실제 산점도
# ══════════════════════════════════════════════════════════════
def plot_pred_vs_true(
    model_ys, scaler_ys, X_ys, y_ys, is_log_ys,
    model_el, scaler_el, X_el, y_el, is_log_el,
) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    for ax, model, scaler, X, y, is_log, label, unit in [
        (axes[0], model_ys, scaler_ys, X_ys, y_ys, is_log_ys, "YS",        "MPa"),
        (axes[1], model_el, scaler_el, X_el, y_el, is_log_el, "Elongation", "%"),
    ]:
        pred_raw = model.predict(scaler.transform(X))
        pred     = np.clip(inverse_transform(pred_raw, is_log), 0, None)
        r2       = r2_score(y, pred)
        mae      = mean_absolute_error(y, pred)

        ax.scatter(y, pred, alpha=0.6, edgecolors="white", linewidths=0.5,
                   color="steelblue" if label == "YS" else "darkorange", s=50)

        lim = [min(float(y.min()), float(pred.min())) * 0.95,
               max(float(y.max()), float(pred.max())) * 1.05]
        ax.plot(lim, lim, "r--", lw=1.5, label="Perfect fit")
        ax.set_xlim(lim); ax.set_ylim(lim)
        ax.set_xlabel(f"True {label} ({unit})")
        ax.set_ylabel(f"Predicted {label} ({unit})")
        ax.set_title(f"{label}  |  R²={r2:.3f}  MAE={mae:.1f} {unit}")
        ax.legend(fontsize=8)

    plt.suptitle("Predicted vs True (Train set — 참고용)", fontsize=12)
    plt.tight_layout()
    out = CACHE_DIR / "pred_vs_true.png"
    plt.savefig(out, dpi=130, bbox_inches="tight")
    plt.close()
    print(f"  저장: {out.name}")


# ══════════════════════════════════════════════════════════════
# 6. 추론 함수 (외부 호출용)
# ══════════════════════════════════════════════════════════════
def predict(composition: dict, model_path: Path) -> float:
    """
    단일 조성 딕셔너리 → 물성 예측값 반환.
    Fix 2: is_log 플래그에 따라 expm1 역변환 자동 적용.

    Parameters
    ----------
    composition : {'Ti': 25, 'Nb': 25, 'Ta': 25, 'Mo': 25, ...}  (at%)
    model_path  : YS_MODEL_LATEST 또는 EL_MODEL_LATEST

    Returns
    -------
    float : 예측값 (원본 스케일 — YS: MPa, 연신율: %)

    Example
    -------
    >>> from scripts.train_model import predict, YS_MODEL_LATEST, EL_MODEL_LATEST
    >>> comp = {'Ti': 20, 'Nb': 20, 'Ta': 20, 'Mo': 20, 'W': 20}
    >>> ys  = predict(comp, YS_MODEL_LATEST)
    >>> el  = predict(comp, EL_MODEL_LATEST)
    """
    with open(model_path, "rb") as f:
        bundle = pickle.load(f)

    model    = bundle["model"]
    scaler   = bundle["scaler"]
    features = bundle["features"]
    is_log   = bundle.get("is_log", False)   # Fix 2: 구버전 번들 호환

    row = {}
    for feat in features:
        if feat.startswith("alloy.") and feat.endswith("_at"):
            elem = feat.replace("alloy.", "").replace("_at", "")
            row[feat] = composition.get(elem, 0.0)
        else:
            row[feat] = 0.0  # descriptor 없으면 0 (실사용 시 predict_with_descriptors 권장)

    X = pd.DataFrame([row])[features]
    X_scaled = scaler.transform(X)

    pred_raw = float(model.predict(X_scaled)[0])
    pred     = float(inverse_transform(np.array([pred_raw]), is_log)[0])
    return max(pred, 0.0)   # 음수 방지


def predict_with_descriptors(row: dict, model_path: Path) -> float:
    """
    조성 + descriptor 모두 포함된 딕셔너리 → 예측값 반환.
    RAG 파이프라인 및 Bayesian Optimization 루프에서 주로 사용.

    Fix 2: is_log 플래그를 번들에서 읽어 expm1 역변환 자동 적용.
           연신율 모델(is_log=True)은 내부적으로 log 스케일로 예측 후
           expm1으로 원본 % 스케일로 되돌림 — 호출 측 코드 변경 불필요.

    Parameters
    ----------
    row : {
        'Ti': 25, 'Nb': 25, ...,            # 조성 at%
        'VEC': 4.5, 'delta_pct': 3.2, ...   # descriptor (없으면 0)
    }
    model_path : YS_MODEL_LATEST 또는 EL_MODEL_LATEST

    Returns
    -------
    float : 예측값 원본 스케일 (YS: MPa, 연신율: %)

    Example
    -------
    >>> row = {'Ti':25,'Nb':25,'Ta':25,'Mo':25,'VEC':4.75,'delta_pct':3.1}
    >>> ys = predict_with_descriptors(row, YS_MODEL_LATEST)
    >>> el = predict_with_descriptors(row, EL_MODEL_LATEST)   # 자동 역변환
    """
    with open(model_path, "rb") as f:
        bundle = pickle.load(f)

    model    = bundle["model"]
    scaler   = bundle["scaler"]
    features = bundle["features"]
    is_log   = bundle.get("is_log", False)   # Fix 2: 역변환 플래그

    feat_row = {}
    for feat in features:
        if feat.startswith("alloy.") and feat.endswith("_at"):
            elem = feat.replace("alloy.", "").replace("_at", "")
            feat_row[feat] = row.get(elem, 0.0)
        elif feat.startswith("alloy."):
            desc_key = feat.replace("alloy.", "")
            feat_row[feat] = row.get(desc_key, 0.0)
        else:
            feat_row[feat] = row.get(feat, 0.0)

    X = pd.DataFrame([feat_row])[features]
    X_scaled = scaler.transform(X)

    pred_raw = float(model.predict(X_scaled)[0])
    # Fix 2: 연신율 모델은 log 스케일로 학습 → expm1 역변환
    pred     = float(inverse_transform(np.array([pred_raw]), is_log)[0])
    return max(pred, 0.0)   # 음수 클리핑


# ══════════════════════════════════════════════════════════════
# 요약 출력
# ══════════════════════════════════════════════════════════════
def print_summary(cv_ys: dict, cv_el: dict, ys_path: Path, el_path: Path) -> None:
    print("\n" + "="*55)
    print(" 모델 학습 리포트")
    print("="*55)
    print()
    print("  [Cross-Validation 결과]  (GroupKFold, 원본 스케일 지표)")
    print(f"  {'':5}  {'R² (mean±std)':<22} {'MAE':<18} {'RMSE':<18}")
    print(f"  {'YS':5}  {cv_ys['R2_mean']:.3f} ± {cv_ys['R2_std']:.3f}        "
          f"{cv_ys['MAE_mean']:.1f} ± {cv_ys['MAE_std']:.1f} MPa    "
          f"{cv_ys['RMSE_mean']:.1f} ± {cv_ys['RMSE_std']:.1f}")
    print(f"  {'El':5}  {cv_el['R2_mean']:.3f} ± {cv_el['R2_std']:.3f}        "
          f"{cv_el['MAE_mean']:.1f} ± {cv_el['MAE_std']:.1f} %      "
          f"{cv_el['RMSE_mean']:.1f} ± {cv_el['RMSE_std']:.1f}")
    print()
    for label, cv in [("YS", cv_ys), ("El", cv_el)]:
        status = "✅ KPI 달성" if cv["R2_mean"] >= 0.80 else "⚠️  R² < 0.80 — 데이터 추가 권장"
        print(f"  {label}: {status}")
    print()
    print("  [Fix 1] 이상치 중복 제거 제거됨 (db_setup에서 ±3σ 클리핑)")
    print(f"  [Fix 2] 연신율 log 변환: {cv_el.get('log_transform', '?')}")
    print(f"  [Fix 3] CV 방법: {cv_el.get('cv_method', 'GroupKFold')}")
    print(f"  [Fix 4] 버전 파일: {ys_path.name}")
    print()
    print("  [생성 파일]")
    print(f"  {ys_path.name}")
    print(f"  {el_path.name}")
    print("  models/ys_model_latest.pkl")
    print("  models/el_model_latest.pkl")
    print("  models/model_report.json     (누적 히스토리)")
    print("  data/cache/shap_ys.png")
    print("  data/cache/shap_ys_beeswarm.png")
    print("  data/cache/shap_el.png")
    print("  data/cache/shap_el_beeswarm.png")
    print("  data/cache/pred_vs_true.png")
    print()
    print("  [사용법]")
    print("  from scripts.train_model import predict_with_descriptors")
    print("  from scripts.train_model import YS_MODEL_LATEST, EL_MODEL_LATEST")
    print("  row = {'Ti':25,'Nb':25,'Ta':25,'Mo':25,'VEC':4.75,'delta_pct':3.1}")
    print("  ys = predict_with_descriptors(row, YS_MODEL_LATEST)")
    print("  el = predict_with_descriptors(row, EL_MODEL_LATEST)  # 자동 역변환")
    print("="*55)


# ══════════════════════════════════════════════════════════════
# main
# ══════════════════════════════════════════════════════════════
def main():
    print("HEA Designer — 회귀 모델 학습 (v2)")

    # 1. 데이터 로드
    d = load_data()
    X_ys, y_ys = d["X_ys"], d["y_ys"]
    X_el, y_el = d["X_el"], d["y_el"]

    # Fix 3: GroupKFold용 groups 로드 (없으면 None → 폴백)
    groups_ys = np.array(d["groups_ys"]) if "groups_ys" in d else None
    groups_el = np.array(d["groups_el"]) if "groups_el" in d else None

    # Fix 1: 이상치 제거 스킵 (db_setup에서 이미 ±3σ 클리핑 완료)
    print("\n" + "="*55)
    print("  2. 이상치 제거 — 스킵 (db_setup.py에서 ±3σ 클리핑 완료)")
    print("="*55)
    print(f"  YS  : {len(y_ys)}행  |  연신율: {len(y_el)}행")

    # Fix 2: log 변환 여부 판단
    print("\n" + "="*55)
    print("  3. 분포 확인 및 log 변환")
    print("="*55)
    _, is_log_ys = log_transform(y_ys, "YS_MPa")
    _, is_log_el = log_transform(y_el, "Elongation_%")

    # Fix 3: GroupKFold 교차검증
    print("\n" + "="*55)
    print("  4. 교차검증 (GroupKFold)")
    print("="*55)
    cv_ys = cross_validate_model(X_ys, y_ys, "YS_MPa",        groups_ys, is_log_ys)
    cv_el = cross_validate_model(X_el, y_el, "Elongation_%",   groups_el, is_log_el)

    # 5. 최종 모델 학습
    print("\n" + "="*55)
    print("  5. 최종 모델 학습 (전체 데이터)")
    print("="*55)
    model_ys, scaler_ys, fi_ys, r2_ys = train_final_model(X_ys, y_ys, is_log_ys, "YS_MPa")
    model_el, scaler_el, fi_el, r2_el = train_final_model(X_el, y_el, is_log_el, "Elongation_%")

    # Fix 4: 버전 관리 저장
    print("\n" + "="*55)
    print("  6. 버전 관리 저장")
    print("="*55)
    ys_path = save_model_versioned(
        model_ys, scaler_ys, list(X_ys.columns),
        "YS_MPa", is_log_ys, r2_ys, "ys", YS_MODEL_LATEST
    )
    el_path = save_model_versioned(
        model_el, scaler_el, list(X_el.columns),
        "Elongation_%", is_log_el, r2_el, "el", EL_MODEL_LATEST
    )

    # 6. SHAP 분석
    print("\n" + "="*55)
    print("  7. SHAP 분석")
    print("="*55)
    plot_shap(model_ys, scaler_ys, X_ys, "YS_MPa",      is_log_ys, CACHE_DIR / "shap_ys.png")
    plot_shap(model_el, scaler_el, X_el, "Elongation_%", is_log_el, CACHE_DIR / "shap_el.png")

    # 7. 예측 vs 실제
    print("\n" + "="*55)
    print("  8. 예측 vs 실제 시각화")
    print("="*55)
    plot_pred_vs_true(
        model_ys, scaler_ys, X_ys, y_ys, is_log_ys,
        model_el, scaler_el, X_el, y_el, is_log_el,
    )

    # Fix 4: 누적 리포트 저장
    print("\n" + "="*55)
    print("  9. 리포트 히스토리 누적")
    print("="*55)
    update_report_history(cv_ys, cv_el, len(y_ys), len(y_el),
                          fi_ys, fi_el, ys_path, el_path)

    print_summary(cv_ys, cv_el, ys_path, el_path)


if __name__ == "__main__":
    main()