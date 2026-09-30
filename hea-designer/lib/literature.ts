import type { Composition } from "./descriptors";

export type PhaseLabel = "BCC" | "BCC+B2" | "BCC+Laves" | "BCC+σ" | "BCC+HCP" | "FCC" | "기타";
export type Confidence = "HIGH" | "MED" | "LOW";

export interface LiteratureEntry {
  id: string;
  composition: Composition;
  phase: PhaseLabel;
  ys: number; // MPa
  el: number; // %
  condition: string;
  testTemp: number; // °C
  title: string;
  authors: string;
  year: number;
  journal: string;
  doi: string | null;
  confidence: Confidence;
  excerpt: string;
}

/**
 * NOTE: 데모용 가상 데이터셋입니다. 조성-물성 수치와 서지 정보는 프로토타입 시연을 위한
 * 값이며, 실제 사용 전 검증된 문헌 데이터로 반드시 교체해야 합니다.
 */
export const LITERATURE: LiteratureEntry[] = [
  {
    id: "L01", composition: { Ti: 28, Zr: 22, Hf: 14, Nb: 26, Ta: 10 }, phase: "BCC", ys: 1040, el: 33,
    condition: "CR 80% + 1000°C/5min", testTemp: 25,
    title: "Microstructure and Mechanical Properties of TiZrHfNbTa Refractory High-Entropy Alloys",
    authors: "J. Kim et al.", year: 2021, journal: "J. Alloys Compd.", doi: null, confidence: "HIGH",
    excerpt: "동일 5원계에서 BCC 단상 관찰. 냉간압연 후 어닐링 조건에서 YS 1040 MPa, 연신율 33% 보고.",
  },
  {
    id: "L02", composition: { Ti: 32, Nb: 28, Ta: 18, Mo: 12, Zr: 10 }, phase: "BCC", ys: 1105, el: 26,
    condition: "CR 70% + 1050°C/10min", testTemp: 25,
    title: "Effect of Mo Addition on Strength–Ductility Balance in TiZrNbTa-Based HEAs",
    authors: "S. Park & H. Lee", year: 2020, journal: "Mater. Sci. Eng. A", doi: null, confidence: "HIGH",
    excerpt: "Mo 증가에 따라 YS 상승, 연신율 선형 감소. 10 at% 이상에서 연신율 30% 미만.",
  },
  {
    id: "L03", composition: { Ti: 25, Zr: 25, Hf: 25, Nb: 25 }, phase: "BCC", ys: 930, el: 39,
    condition: "균질화 1200°C/24h", testTemp: 25,
    title: "Phase Stability Map for Equiatomic Ti-Zr-Hf-Nb-Ta Systems",
    authors: "M. Zhang et al.", year: 2019, journal: "Acta Mater.", doi: null, confidence: "MED",
    excerpt: "등몰비 4원계에서 넓은 BCC 안정 영역 확인. VEC 4.2–4.6 범위에서 단상 유지.",
  },
  {
    id: "L04", composition: { Ti: 38, Nb: 28, Hf: 16, V: 10, Al: 8 }, phase: "BCC+B2", ys: 1050, el: 28,
    condition: "CR 75% + 980°C/8min", testTemp: 25,
    title: "Al-Induced Intermetallic Formation in Ti-Nb-Based Refractory HEAs",
    authors: "R. Silva et al.", year: 2022, journal: "Intermetallics", doi: null, confidence: "MED",
    excerpt: "Al 8 at%에서 국부 B2 관찰, 연신율 영향 제한적. Al 15 at% 이상에서 취성 급증.",
  },
  {
    id: "L05", composition: { W: 30, Mo: 30, Ta: 20, Nb: 20 }, phase: "BCC", ys: 1400, el: 6,
    condition: "as-cast", testTemp: 25,
    title: "High-Temperature Strength Retention in W-Mo-Ta-Nb Refractory HEAs",
    authors: "T. Nakamura et al.", year: 2018, journal: "Int. J. Refract. Met. Hard Mater.", doi: null, confidence: "HIGH",
    excerpt: "800°C에서도 YS 800 MPa 이상 유지. 상온 연신율 10% 미만.",
  },
  {
    id: "L06", composition: { W: 25, Mo: 25, Ta: 25, Nb: 25 }, phase: "BCC", ys: 1320, el: 9,
    condition: "균질화 1200°C", testTemp: 25,
    title: "Sigma Phase Formation Kinetics in W-Containing BCC High-Entropy Alloys",
    authors: "A. Petrov & D. Ivanov", year: 2020, journal: "J. Mater. Sci.", doi: null, confidence: "MED",
    excerpt: "W+Mo > 50 at%, 1000°C 미만 균질화 시 석출 관찰. 1200°C 이상 균질화로 억제.",
  },
  {
    id: "L07", composition: { Al: 15, V: 20, Cr: 20, Ti: 25, Zr: 20 }, phase: "BCC+Laves", ys: 1150, el: 16,
    condition: "as-cast", testTemp: 25,
    title: "Lattice Distortion (δ) Threshold for Amorphization in Light-Weight HEAs",
    authors: "F. Chen et al.", year: 2021, journal: "Scripta Mater.", doi: null, confidence: "MED",
    excerpt: "δ > 7 조건에서 비정질/금속간화합물 형성 빈도 급증. 고 Al 경량 조성에서 두드러짐.",
  },
  {
    id: "L08", composition: { Ti: 30, Zr: 30, Nb: 20, Ta: 20 }, phase: "BCC", ys: 980, el: 31,
    condition: "CR 80% + 1000°C/10min", testTemp: 25,
    title: "Hf-Free TiZrNbTa Alloys for Cost-Effective Ductile RHEAs",
    authors: "K. Lee et al.", year: 2022, journal: "Mater. Des.", doi: null, confidence: "MED",
    excerpt: "Hf 제거 시 YS 소폭 감소, 연성 유지. 원가 절감 측면 유리.",
  },
  {
    id: "L09", composition: { Ti: 20, Zr: 20, Hf: 20, Nb: 20, Ta: 20 }, phase: "BCC", ys: 930, el: 35,
    condition: "균질화 + CR 85% + 1000°C", testTemp: 25,
    title: "Equiatomic HfNbTaTiZr: Tensile Behavior after Thermomechanical Processing",
    authors: "D. Novak et al.", year: 2017, journal: "Mater. Sci. Eng. A", doi: null, confidence: "HIGH",
    excerpt: "등몰 5원계 BCC 단상. 상온 인장 연신율 30% 이상 확보.",
  },
  {
    id: "L10", composition: { Nb: 25, Mo: 25, Ta: 25, W: 25 }, phase: "BCC", ys: 1058, el: 2,
    condition: "as-cast", testTemp: 25,
    title: "Room-Temperature Compressive Behavior of NbMoTaW",
    authors: "L. Garcia et al.", year: 2016, journal: "Intermetallics", doi: null, confidence: "MED",
    excerpt: "상온 압축 거동, 파단 변형률 매우 낮음.",
  },
  {
    id: "L11", composition: { Ti: 35, Nb: 35, Ta: 15, Zr: 15 }, phase: "BCC", ys: 890, el: 36,
    condition: "CR 80% + 950°C/5min", testTemp: 25,
    title: "Nb-Rich TiNbTaZr Alloys with Enhanced Tensile Ductility",
    authors: "Y. Wang et al.", year: 2023, journal: "J. Mater. Res. Technol.", doi: null, confidence: "LOW",
    excerpt: "Nb 증가 시 연신율 향상, 강도 감소 경향.",
  },
  {
    id: "L12", composition: { Ti: 30, V: 30, Nb: 25, Cr: 15 }, phase: "BCC+Laves", ys: 1180, el: 11,
    condition: "as-cast", testTemp: 25,
    title: "Cr-Induced Laves Phase in TiVNb-Based Lightweight RHEAs",
    authors: "H. Choi et al.", year: 2021, journal: "Mater. Charact.", doi: null, confidence: "LOW",
    excerpt: "Cr 15 at%에서 C15 Laves 석출 관찰, 연성 저하.",
  },
  {
    id: "L13", composition: { Ti: 25, Zr: 25, Nb: 25, V: 25 }, phase: "BCC", ys: 1020, el: 22,
    condition: "균질화 1100°C/24h", testTemp: 25,
    title: "Mechanical Behavior of TiZrNbV Medium-Density RHEA",
    authors: "P. Rossi et al.", year: 2020, journal: "J. Alloys Compd.", doi: null, confidence: "MED",
    excerpt: "밀도 6.5 g/cm³ 수준, 강도-연성 균형 양호.",
  },
  {
    id: "L14", composition: { Mo: 20, Nb: 30, Ta: 30, Ti: 20 }, phase: "BCC", ys: 1210, el: 14,
    condition: "균질화 1400°C/24h", testTemp: 25,
    title: "Ti Addition to Improve Ductility of MoNbTa RHEAs",
    authors: "S. Ito et al.", year: 2019, journal: "Scripta Mater.", doi: null, confidence: "MED",
    excerpt: "Ti 첨가로 연성 개선, 여전히 20% 미만.",
  },
];

export function formula(c: Composition, digits = 0): string {
  return Object.entries(c)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}${Number(v.toFixed(digits))}`)
    .join("");
}

/** Normalised L1 distance between two compositions, in [0, 1]. */
export function compositionDistance(a: Composition, b: Composition): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let s = 0;
  keys.forEach((k) => {
    s += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
  });
  return s / 200;
}

export function nearestLiterature(c: Composition, k = 3) {
  return LITERATURE.map((l) => ({ entry: l, distance: compositionDistance(c, l.composition) }))
    .sort((x, y) => x.distance - y.distance)
    .slice(0, k);
}
