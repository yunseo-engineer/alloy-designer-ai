"""
app.py — HEA Designer FastAPI 백엔드
=====================================
HTML 챗봇 ↔ RAG 파이프라인 연결 서버

실행:
    pip install fastapi uvicorn
    uvicorn app:app --reload --port 8000

폴더 구조 (app.py를 alloy-designer-ai/ 루트에 놓기):
    alloy-designer-ai/
    ├── app.py                  ← 이 파일
    ├── hea_chatbot.html        ← 챗봇 HTML
    ├── .env                    ← ANTHROPIC_API_KEY
    ├── data/hea_designer.db
    ├── models/ys_model_latest.pkl
    ├── models/el_model_latest.pkl
    ├── papers/processed/*.pdf
    └── vector_db/              ← FAISS 캐시 저장 위치
"""

from __future__ import annotations

import json
import os
import pickle
import re
import sqlite3
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
import faiss
import fitz
from anthropic import Anthropic
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

load_dotenv()

# ══════════════════════════════════════════════════════════════
# 경로 / 상수
# ══════════════════════════════════════════════════════════════
BASE_DIR         = Path(__file__).resolve().parent
DB_PATH          = BASE_DIR / "data"    / "hea_designer.db"
YS_MODEL_PATH    = BASE_DIR / "models" / "ys_model_latest.pkl"
EL_MODEL_PATH    = BASE_DIR / "models" / "el_model_latest.pkl"
PAPER_DIR        = BASE_DIR / "papers" / "processed"
VECTOR_DIR       = BASE_DIR / "vector_db"
FAISS_INDEX_PATH = VECTOR_DIR / "hea.index"
CHUNKS_PATH      = VECTOR_DIR / "chunks.json"
VECTOR_DIR.mkdir(exist_ok=True)

CLAUDE_MODEL = "claude-sonnet-4-5-20250929"
EMBED_MODEL  = "sentence-transformers/all-mpnet-base-v2"
ELEMENTS     = ["Ti","Zr","Hf","V","Nb","Ta","Cr","Mo","W","Al"]
R_GAS        = 8.314

_ELEM_PROPS = {
    "Ti": dict(VEC=4, r=1.462, Tm=1941,  rho=4.51),
    "Zr": dict(VEC=4, r=1.603, Tm=2128,  rho=6.51),
    "Hf": dict(VEC=4, r=1.580, Tm=2506,  rho=13.31),
    "V":  dict(VEC=5, r=1.316, Tm=2183,  rho=6.11),
    "Nb": dict(VEC=5, r=1.429, Tm=2750,  rho=8.57),
    "Ta": dict(VEC=5, r=1.430, Tm=3290,  rho=16.69),
    "Cr": dict(VEC=6, r=1.249, Tm=2180,  rho=7.19),
    "Mo": dict(VEC=6, r=1.363, Tm=2896,  rho=10.28),
    "W":  dict(VEC=6, r=1.371, Tm=3695,  rho=19.35),
    "Al": dict(VEC=3, r=1.432, Tm=933,   rho=2.70),
}

# ══════════════════════════════════════════════════════════════
# 전역 싱글턴 (서버 기동 시 1회 초기화)
# ══════════════════════════════════════════════════════════════
client      = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
embed_model = SentenceTransformer(EMBED_MODEL)
ys_bundle:  Optional[Dict] = None
el_bundle:  Optional[Dict] = None
_faiss_index: Optional[faiss.Index] = None
_chunks:      Optional[List[Dict]]  = None


# ══════════════════════════════════════════════════════════════
# FastAPI 앱
# ══════════════════════════════════════════════════════════════
app = FastAPI(title="HEA Designer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # 로컬 개발용 — 배포 시 도메인 한정
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── HTML 파일 직접 서빙 ───────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def root():
    html_path = BASE_DIR / "hea_chatbot.html"
    if html_path.exists():
        return HTMLResponse(html_path.read_text(encoding="utf-8"))
    return HTMLResponse("<h2>hea_chatbot.html 파일을 alloy-designer-ai/ 루트에 놓으세요.</h2>")


# ══════════════════════════════════════════════════════════════
# 시작 시 초기화
# ══════════════════════════════════════════════════════════════
@app.on_event("startup")
async def startup():
    global ys_bundle, el_bundle, _faiss_index, _chunks

    # ML 모델 로드
    ys_bundle = _load_bundle(YS_MODEL_PATH)
    el_bundle = _load_bundle(EL_MODEL_PATH)
    print(f"[startup] YS 모델: {'OK' if ys_bundle else '없음'}")
    print(f"[startup] EL 모델: {'OK' if el_bundle else '없음'}")

    # FAISS 캐시 로드 (없으면 PDF 처리)
    _faiss_index, _chunks = _load_vector_db()
    print(f"[startup] FAISS: {_faiss_index.ntotal:,}개 벡터 로드")


def _load_bundle(path: Path) -> Optional[Dict]:
    if not path.exists():
        print(f"  ⚠ 모델 없음: {path}")
        return None
    with open(path, "rb") as f:
        b = pickle.load(f)
    return {"model": b["model"], "scaler": b["scaler"],
            "features": b["features"], "is_log": b.get("is_log", False)}


# ══════════════════════════════════════════════════════════════
# FAISS 관련
# ══════════════════════════════════════════════════════════════
def _load_vector_db():
    if FAISS_INDEX_PATH.exists() and CHUNKS_PATH.exists():
        print("[FAISS] 캐시 로드 중...")
        idx = faiss.read_index(str(FAISS_INDEX_PATH))
        with open(CHUNKS_PATH, "r", encoding="utf-8") as f:
            chunks = json.load(f)
        return idx, chunks

    print("[FAISS] 캐시 없음 → PDF 처리 시작...")
    return _build_faiss_from_pdfs()


def _build_faiss_from_pdfs():
    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    all_chunks: List[str]  = []
    all_metas:  List[Dict] = []

    for pdf_path in sorted(PAPER_DIR.glob("*.pdf")):
        try:
            doc = fitz.open(pdf_path)
            for pi, page in enumerate(doc):
                text = page.get_text()
                if text and len(text.strip()) > 50:
                    for chunk in splitter.split_text(text):
                        all_chunks.append(chunk)
                        all_metas.append({"paper": pdf_path.name,
                                          "page": pi + 1, "text": chunk})
        except Exception as e:
            print(f"  ⚠ {pdf_path.name}: {e}")

    if not all_chunks:
        idx = faiss.IndexFlatL2(768)
        return idx, []

    print(f"  총 {len(all_chunks)}개 청크 임베딩 중...")
    vecs = embed_model.encode(all_chunks, convert_to_numpy=True,
                              show_progress_bar=True).astype("float32")
    idx = faiss.IndexFlatL2(vecs.shape[1])
    idx.add(vecs)
    faiss.write_index(idx, str(FAISS_INDEX_PATH))
    with open(CHUNKS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_metas, f, ensure_ascii=False, indent=2)
    print(f"  FAISS 저장 완료: {idx.ntotal}개 벡터")
    return idx, all_metas


# ══════════════════════════════════════════════════════════════
# 파이프라인 함수들
# ══════════════════════════════════════════════════════════════

_PARSE_SYSTEM = """
You are a BCC High-Entropy Alloy expert. Extract the user query into JSON only.
Return ONLY valid JSON with no markdown fences.

{
  "ys_min":       <float|null>,
  "el_min":       <float|null>,
  "bcc_required": <true|false>,
  "elements":     [<str>],
  "temp_C":       <float|null>
}
"""

def _parse_query(user_query: str) -> Dict:
    resp = client.messages.create(
        model=CLAUDE_MODEL, max_tokens=300,
        system=_PARSE_SYSTEM,
        messages=[{"role": "user", "content": user_query}]
    )
    text = resp.content[0].text.strip()
    text = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`").strip()
    try:
        return json.loads(text)
    except Exception:
        return {"ys_min": None, "el_min": None, "bcc_required": True,
                "elements": [], "temp_C": None}


def _search_sqlite(parsed: Dict, limit: int = 10) -> pd.DataFrame:
    if not DB_PATH.exists():
        return pd.DataFrame()
    try:
        conn   = sqlite3.connect(DB_PATH)
        query  = "SELECT * FROM measurements WHERE 1=1"
        params = []
        if parsed.get("ys_min"):
            query += " AND meas_YS_MPa >= ?"; params.append(parsed["ys_min"])
        if parsed.get("el_min"):
            query += " AND meas_elongation_pct >= ?"; params.append(parsed["el_min"])
        if parsed.get("bcc_required"):
            query += " AND meas_is_BCC_single = 1"
        for el in parsed.get("elements", []):
            query += f" AND alloy_{el}_at > 0"
        query += f" ORDER BY meas_YS_MPa DESC LIMIT {limit}"
        df = pd.read_sql_query(query, conn, params=params)
        conn.close()
        return df
    except Exception as e:
        print(f"[SQLite] 오류: {e}")
        return pd.DataFrame()


def _search_papers(query: str, top_k: int = 5) -> List[Dict]:
    if _faiss_index is None or _faiss_index.ntotal == 0:
        return []
    qvec = embed_model.encode([query], convert_to_numpy=True).astype("float32")
    dists, idxs = _faiss_index.search(qvec, top_k)
    results = []
    for dist, idx in zip(dists[0], idxs[0]):
        if 0 <= idx < len(_chunks):
            c = _chunks[idx]
            results.append({**c, "score": round(float(dist), 3)})
    return results


def _calc_descriptors(comp: Dict) -> Dict:
    total = sum(comp.values())
    if total <= 0:
        return {}
    c = {el: v / total for el, v in comp.items() if v > 0 and el in _ELEM_PROPS}
    if not c:
        return {}
    VEC    = sum(c[el] * _ELEM_PROPS[el]["VEC"] for el in c)
    r_mean = sum(c[el] * _ELEM_PROPS[el]["r"]   for el in c)
    delta  = 100 * sum(c[el]*(1-_ELEM_PROPS[el]["r"]/r_mean)**2 for el in c)**0.5
    dS     = -R_GAS * sum(x*np.log(x) for x in c.values())
    Tm     = sum(c[el] * _ELEM_PROPS[el]["Tm"]  for el in c)
    rho    = sum(c[el] * _ELEM_PROPS[el]["rho"] for el in c)
    return {
        "alloy.VEC":               round(VEC,   3),
        "alloy.delta_pct":         round(delta, 3),
        "alloy.dH_mix_kJ":         0.0,
        "alloy.dS_mix_J":          round(dS,    3),
        "alloy.Tm_mix_K":          round(Tm,    1),
        "alloy.density_calc_gcm3": round(rho,   3),
        "alloy.Omega":             round(Tm*dS/1e-3, 3),
        "alloy.Lambda":            round(dS/(delta**2+1e-6), 5),
    }


def _align_features(df: pd.DataFrame, features: List[str]) -> pd.DataFrame:
    row = {}
    for feat in features:
        if feat in df.columns:
            row[feat] = df[feat].iloc[0]
        else:
            alt = feat.replace(".", "_")
            row[feat] = df[alt].iloc[0] if alt in df.columns else 0.0
    return pd.DataFrame([row])[features]


def _predict(sample_df: pd.DataFrame) -> Dict:
    result = {"YS_MPa": None, "EL_pct": None}
    for key, bundle in [("YS_MPa", ys_bundle), ("EL_pct", el_bundle)]:
        if bundle is None:
            continue
        try:
            X    = _align_features(sample_df, bundle["features"])
            Xsc  = bundle["scaler"].transform(X)
            raw  = float(bundle["model"].predict(Xsc)[0])
            val  = float(np.expm1(raw)) if bundle["is_log"] else raw
            result[key] = round(max(val, 0), 1)
        except Exception as e:
            print(f"  ⚠ {key} 예측 오류: {e}")
    return result


def _sql_row_to_df(row: pd.Series) -> pd.DataFrame:
    comp = {el: float(row.get(f"alloy_{el}_at") or 0) for el in ELEMENTS}
    desc = _calc_descriptors(comp)
    record = {f"alloy.{el}_at": comp.get(el, 0.0) for el in ELEMENTS}
    record.update(desc)
    record["meas.test_temp_C"] = float(row.get("meas_test_temp_C") or 25.0)
    return pd.DataFrame([record])


_ANSWER_SYSTEM = """
You are a BCC High-Entropy Alloy expert. Answer in Korean using the 3-tier evidence below.

Format:
## 기존 실험 데이터 기반 추천
[추천 N]
- 조성: (at%)
- YS 실측/예측:
- 연신율 실측/예측:
- BCC 안정성: VEC, δ 포함
- 논문 근거: (논문명, 페이지)
- 권장 공정:
- 주의사항:

## Bayesian Optimization 신규 탐색 조성
(ML 예측, 실험 검증 필수)
[신규 조성 N] — 동일 포맷

## 실험 우선순위
1순위 / 2순위 — 이유 포함
"""

def _build_context(user_query: str, parsed: Dict, sql_df: pd.DataFrame,
                   papers: List[Dict], preds: Dict) -> str:
    sql_ctx = (
        "DB에서 조건 맞는 데이터 없음" if sql_df.empty
        else sql_df[[c for c in
                     ["alloy_composition_formula","meas_YS_MPa",
                      "meas_elongation_pct","meas_is_BCC_single","paper_title"]
                     if c in sql_df.columns]].head(5).to_json(
                         force_ascii=False, orient="records")
    )
    paper_ctx = json.dumps([
        {"paper": r["paper"], "page": r["page"], "text": r["text"][:350]}
        for r in papers[:4]
    ], ensure_ascii=False, indent=2)

    return f"""사용자 질의: {user_query}
파싱 조건: {json.dumps(parsed, ensure_ascii=False)}

[계층 1] 실험 DB:
{sql_ctx}

[계층 2] 관련 논문:
{paper_ctx}

[계층 3] ML 예측:
YS={preds.get('YS_MPa')} MPa, EL={preds.get('EL_pct')} %
(학습 데이터 기반 최상위 DB 조성 예측값)
"""


# ══════════════════════════════════════════════════════════════
# API 엔드포인트
# ══════════════════════════════════════════════════════════════

class ChatRequest(BaseModel):
    message: str
    history: List[Dict] = []

class ChatResponse(BaseModel):
    answer: str
    trace:  Dict


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """RAG 5단계 파이프라인 → 완성된 답변 한 번에 반환."""
    q = req.message.strip()
    if not q:
        return ChatResponse(answer="질문을 입력해주세요.", trace={})

    trace: Dict = {}

    # Step 1: 질의 파싱
    parsed = _parse_query(q)
    trace["parsed"] = parsed

    # Step 2: SQLite 검색
    sql_df = _search_sqlite(parsed)
    trace["sql_count"] = len(sql_df)

    # Step 3: 논문 검색
    formulas = []
    if not sql_df.empty and "alloy_composition_formula" in sql_df.columns:
        formulas = sql_df["alloy_composition_formula"].dropna().head(3).tolist()
    papers = _search_papers(q + " " + " ".join(formulas))
    trace["paper_count"] = len(papers)

    # Step 4: ML 예측
    preds = {"YS_MPa": None, "EL_pct": None}
    if not sql_df.empty:
        try:
            preds = _predict(_sql_row_to_df(sql_df.iloc[0]))
        except Exception as e:
            print(f"[ML] {e}")
    trace["ml_preds"] = preds

    # Step 5: 최종 답변
    context = _build_context(q, parsed, sql_df, papers, preds)
    msgs    = list(req.history) + [{"role": "user", "content": context}]
    resp    = client.messages.create(
        model=CLAUDE_MODEL, max_tokens=2500,
        system=_ANSWER_SYSTEM, messages=msgs
    )
    answer = resp.content[0].text
    trace["answer_len"] = len(answer)

    return ChatResponse(answer=answer, trace=trace)


@app.get("/health")
async def health():
    return {
        "status":   "ok",
        "db":       DB_PATH.exists(),
        "faiss":    _faiss_index.ntotal if _faiss_index else 0,
        "ys_model": ys_bundle is not None,
        "el_model": el_bundle is not None,
    }
