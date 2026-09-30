import type { Composition, Descriptors } from "./descriptors";
import type { Prediction } from "./model";
import type { Targets } from "./designSpace";
import { ELEMENT_PROPS } from "./elementData";

export type RiskLevel = "높음" | "중간" | "낮음";

export interface RiskItem {
  level: RiskLevel;
  title: string;
  basis: string;
  action: string;
}

const at = (c: Composition, el: string) => {
  const total = Object.values(c).reduce((s, v) => s + v, 0) || 1;
  return ((c[el] ?? 0) / total) * 100;
};

/** Rule-based pre-experiment checks. Each item names the rule it comes from. */
export function assessRisks(c: Composition, d: Descriptors, p: Prediction, t: Targets): RiskItem[] {
  const out: RiskItem[] = [];
  const kinds = Object.keys(c).map((el) => ({ el, kind: ELEMENT_PROPS[el]?.kind }));
  const nonMetal = kinds.filter((k) => k.kind === "gas" || k.kind === "nonmetal").map((k) => k.el);
  const radioactive = kinds.filter((k) => k.kind === "radioactive").map((k) => k.el);
  if (nonMetal.length)
    out.push({
      level: "높음",
      title: `기체·비금속 원소 포함 (${nonMetal.join(", ")})`,
      basis: "고용체 판별 규칙과 예측 모델은 금속 원소 합금을 전제로 함",
      action: "침입형 원소·도펀트로 다룰지 검토하고, 주 원소 조합에서는 제외 권장",
    });
  if (radioactive.length)
    out.push({
      level: "높음",
      title: `방사성 원소 포함 (${radioactive.join(", ")})`,
      basis: "취급 허가·차폐 설비 필요, 물성값은 추정치",
      action: "연구 목적상 필수인지 확인, 일반 실험실 용해 불가",
    });
  if (d.estElements.length && !nonMetal.length && !radioactive.length)
    out.push({
      level: "중간",
      title: `추정 물성 사용 (${d.estElements.join(", ")})`,
      basis: "해당 원소의 반경·융점·밀도가 참고값이 아닌 추정치",
      action: "descriptor 값을 문헌값으로 교차 확인",
    });
  if (d.missingPairs.length)
    out.push({
      level: d.missingPairs.length >= 3 ? "중간" : "낮음",
      title: `ΔHmix 미등록 원소쌍 ${d.missingPairs.length}개`,
      basis: `${d.missingPairs.slice(0, 6).join(", ")}${d.missingPairs.length > 6 ? " …" : ""} → 0 kJ/mol로 가정`,
      action: "Miedema 표에서 값 확인 후 ΔHmix·Ω 재평가",
    });
  const al = at(c, "Al");
  const wmo = at(c, "W") + at(c, "Mo");
  const cr = at(c, "Cr");
  const hf = at(c, "Hf");

  if (al >= 10)
    out.push({
      level: al >= 15 ? "높음" : "중간",
      title: `B2 / 금속간화합물 형성 가능 (Al ${al.toFixed(1)} at%)`,
      basis: "Al ≥ 10 at%에서 Ti·Nb와 B2 정렬상 형성 보고 (문헌 L04, L07)",
      action: "XRD 초격자 피크 확인, 필요 시 Al ≤ 8 at%로 조정",
    });
  if (wmo >= 40)
    out.push({
      level: "높음",
      title: `상온 취성 (W+Mo ${wmo.toFixed(0)} at%)`,
      basis: "W·Mo 고함량 RHEA의 상온 연신율 < 10% 보고 (문헌 L05, L06, L10)",
      action: "냉간 대신 온간 압연 검토, 압축 시험 병행",
    });
  if (cr >= 10)
    out.push({
      level: cr >= 15 ? "높음" : "중간",
      title: `Laves 상 석출 가능 (Cr ${cr.toFixed(1)} at%)`,
      basis: "Cr 함유 Ti-V-Nb계에서 C15 Laves 관찰 (문헌 L12)",
      action: "균질화 후 SEM-BSE로 2차상 확인",
    });
  if (d.delta > 6.0)
    out.push({
      level: d.delta > 6.6 ? "높음" : "중간",
      title: `격자 왜곡 큼 (δ = ${d.delta.toFixed(2)} %)`,
      basis: "δ ≤ 6.6 % 고용체 기준 (Yang & Zhang, 2012)",
      action: "원자 반경 차가 큰 원소(Zr·Hf vs Cr·V) 비율 재조정",
    });
  if (p.extrapolated)
    out.push({
      level: "중간",
      title: `예측 외삽 영역 (문헌 최근접 거리 ${p.dMin.toFixed(2)})`,
      basis: "학습 데이터와 조성 거리가 임계값 0.30을 초과",
      action: "소량 버튼 시편으로 우선 검증 — 능동 학습 우선 후보",
    });
  if (p.el - p.elCi < t.el && p.el >= t.el)
    out.push({
      level: "중간",
      title: "연신율 목표 경계",
      basis: `예측 하한 ${(p.el - p.elCi).toFixed(1)} % < 목표 ${t.el} %`,
      action: "어닐링 온도 +50°C 조건을 병행 시편으로 준비",
    });
  if (p.ys - p.ysCi < t.ys && p.ys >= t.ys)
    out.push({
      level: "중간",
      title: "항복강도 목표 경계",
      basis: `예측 하한 ${p.ys - p.ysCi} MPa < 목표 ${t.ys} MPa`,
      action: "냉간압연율 상향 조건을 병행 시편으로 준비",
    });
  if (t.rhoMax != null && d.rho > t.rhoMax)
    out.push({
      level: "중간",
      title: `밀도 제약 초과 (${d.rho.toFixed(2)} g/cm³)`,
      basis: `밀도 상한 ${t.rhoMax} g/cm³`,
      action: "Ti·V·Al 등 저밀도 원소 비율 상향",
    });
  if (hf >= 15)
    out.push({
      level: "낮음",
      title: `원료 원가 (Hf ${hf.toFixed(0)} at%)`,
      basis: "Hf 원료 단가가 높아 스케일업 시 비용 부담",
      action: "Hf ≤ 10 at% 대안 조성 병행 검토 (문헌 L08)",
    });
  return out;
}

export interface ProcessPlan {
  melt: string;
  homogenize: string;
  roll: string;
  anneal: string;
  quench: string;
  rollReduction: number;
  annealC: number;
  annealMin: number;
  basis: string;
}

/** Suggest thermomechanical route from Tm and predicted ductility. */
export function suggestProcess(d: Descriptors, p: Prediction): ProcessPlan {
  const homogC = Math.min(1400, Math.round((0.6 * d.tm - 273) / 50) * 50);
  const annealC = Math.round((0.5 * d.tm - 273) / 25) * 25;
  const warm = p.el < 15;
  const rollReduction = p.el >= 25 ? 80 : p.el >= 15 ? 65 : 40;
  const annealMin = p.el >= 25 ? 5 : 10;
  return {
    melt: "진공 아크 용해, Ti-gettered 고순도 Ar, 5회 이상 뒤집어 재용해",
    homogenize: `${homogC}°C · 24 h · Ar 봉입 후 노냉`,
    roll: warm ? `온간 압연 ${rollReduction}% (약 600°C)` : `냉간 압연 ${rollReduction}%`,
    anneal: `${annealC}°C · ${annealMin} min`,
    quench: "수냉 (WQ)",
    rollReduction,
    annealC,
    annealMin,
    basis: `균질화 ≈ 0.6·Tm, 재결정 어닐링 ≈ 0.5·Tm (Tm = ${Math.round(d.tm)} K)`,
  };
}
