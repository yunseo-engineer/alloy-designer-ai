import type { Composition, Descriptors } from "./descriptors";
import { LITERATURE, compositionDistance } from "./literature";

/**
 * Demo surrogate model. Physically-motivated closed form so that numbers move
 * sensibly when the composition is edited. NOT a trained model.
 */
export const MODEL_CARD = {
  name: "HEA-SS surrogate",
  version: "v0.3-demo",
  type: "고용강화 기반 해석식 + 문헌 거리 기반 불확실도 (데모용)",
  inputs: ["조성 (at%)", "VEC", "δ", "ΔHmix"],
  trainingSize: LITERATURE.length,
  validation: { ysRmse: 118, elRmse: 6.2, note: "데모 값 · 실제 검증 아님" },
  ysFormula: "YS ≈ Σ cᵢσᵢ + 353·δ^0.43 + 180·max(0, VEC − 4) + 8·max(0, −ΔHmix)",
  elFormula: "EL ≈ 48 − 38·max(0, VEC − 4.2) − 1.8·δ − 1.2·c_Al − 0.4·max(0, −ΔHmix)",
  ciFormula: "CI₉₅ = a + b·d_min + 추정 물성 원소·ΔH 미등록 쌍 가산  (d_min: 최근접 학습 조성과의 L1 거리)",
  extrapolationThreshold: 0.3,
};

// Intrinsic strength contribution per element (MPa) — demo parameters.
const SIGMA: Record<string, number> = {
  Al: 200, Ti: 250, V: 350, Cr: 400, Zr: 280, Nb: 240, Mo: 450, Hf: 250, Ta: 300, W: 550,
};

export interface Prediction {
  ys: number;
  ysCi: number;
  el: number;
  elCi: number;
  dMin: number;
  extrapolated: boolean;
}

export function minLiteratureDistance(c: Composition): number {
  let best = 1;
  for (const l of LITERATURE) {
    const d = compositionDistance(c, l.composition);
    if (d < best) best = d;
  }
  return best;
}

export function predict(c: Composition, d: Descriptors): Prediction {
  const total = Object.values(c).reduce((s, v) => s + v, 0) || 1;
  let base = 0;
  for (const [el, v] of Object.entries(c)) base += (v / total) * (SIGMA[el] ?? 250);
  const ys =
    base +
    353 * Math.pow(d.delta, 0.43) +
    180 * Math.max(0, d.vec - 4) +
    8 * Math.max(0, -d.dHmix);
  const al = ((c.Al ?? 0) / total) * 100;
  const el =
    48 - 38 * Math.max(0, d.vec - 4.2) - 1.8 * d.delta - 1.2 * al - 0.4 * Math.max(0, -d.dHmix);

  const dMin = minLiteratureDistance(c);
  return {
    ys: Math.round(ys / 5) * 5,
    ysCi: Math.round(45 + 260 * dMin + 40 * d.estElements.length + 15 * d.missingPairs.length),
    el: Math.round(Math.min(60, Math.max(1, el)) * 10) / 10,
    elCi: Math.round((2.5 + 14 * dMin + 2 * d.estElements.length + d.missingPairs.length) * 10) / 10,
    dMin,
    extrapolated: dMin > MODEL_CARD.extrapolationThreshold || d.estElements.length > 0,
  };
}
