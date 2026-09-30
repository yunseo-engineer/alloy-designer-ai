/**
 * Elemental property table used for descriptor calculation — all 118 elements.
 *
 * quality:
 *  - "ref" : 금속/준금속 — 핸드북·HEA 문헌에서 널리 쓰는 값 (금속 반경 CN12 기준)
 *  - "est" : 기체·비금속·방사성·초중원소 — 공유/추정 반경, 고체 밀도 추정치 등. 합금 설계 신뢰도 낮음
 *
 * Sources (prototype — re-verify before real use):
 *  - metallic radius, VEC: Guo et al., J. Appl. Phys. 109 (2011) 103505 외 표 값
 *  - melting point, density: 일반 물성 핸드북 값
 *  - ΔHmix pair values: Takeuchi & Inoue, Mater. Trans. 46 (2005) 2817 (근사 인용, 일부 쌍만 등록)
 */
import { ELEMENTS } from "@/mock/elements";

export type DataQuality = "ref" | "est";

export interface ElementProps {
  symbol: string;
  name: string;
  A: number; // atomic weight, g/mol
  r: number; // radius, pm
  vec: number;
  tm: number; // melting point, K
  rho: number; // density, g/cm3 (solid)
  quality: DataQuality;
  kind: "metal" | "metalloid" | "nonmetal" | "gas" | "radioactive";
}

// symbol: [r, VEC, Tm, rho, quality, kind]
type Row = [number, number, number, number, DataQuality, ElementProps["kind"]];
const RAW: Record<string, Row> = {
  H: [78, 1, 14, 0.09, "est", "gas"], He: [128, 2, 1, 0.13, "est", "gas"],
  Li: [152, 1, 454, 0.53, "ref", "metal"], Be: [112, 2, 1560, 1.85, "ref", "metal"],
  B: [85, 3, 2349, 2.34, "est", "metalloid"], C: [77, 4, 3823, 2.27, "est", "nonmetal"],
  N: [75, 5, 63, 1.03, "est", "gas"], O: [73, 6, 54, 1.43, "est", "gas"],
  F: [71, 7, 53, 1.7, "est", "gas"], Ne: [154, 8, 25, 1.44, "est", "gas"],
  Na: [186, 1, 371, 0.97, "ref", "metal"], Mg: [160, 2, 923, 1.74, "ref", "metal"],
  Al: [143, 3, 933, 2.7, "ref", "metal"], Si: [115, 4, 1687, 2.33, "ref", "metalloid"],
  P: [106, 5, 317, 1.82, "est", "nonmetal"], S: [102, 6, 388, 2.07, "est", "nonmetal"],
  Cl: [99, 7, 172, 2.03, "est", "gas"], Ar: [188, 8, 84, 1.62, "est", "gas"],
  K: [227, 1, 337, 0.89, "ref", "metal"], Ca: [197, 2, 1115, 1.55, "ref", "metal"],
  Sc: [164, 3, 1814, 2.99, "ref", "metal"], Ti: [147, 4, 1941, 4.51, "ref", "metal"],
  V: [134, 5, 2183, 6.11, "ref", "metal"], Cr: [128, 6, 2180, 7.19, "ref", "metal"],
  Mn: [127, 7, 1519, 7.21, "ref", "metal"], Fe: [126, 8, 1811, 7.87, "ref", "metal"],
  Co: [125, 9, 1768, 8.9, "ref", "metal"], Ni: [124, 10, 1728, 8.91, "ref", "metal"],
  Cu: [128, 11, 1358, 8.96, "ref", "metal"], Zn: [134, 12, 693, 7.14, "ref", "metal"],
  Ga: [135, 3, 303, 5.91, "ref", "metal"], Ge: [125, 4, 1211, 5.32, "ref", "metalloid"],
  As: [120, 5, 1090, 5.73, "est", "metalloid"], Se: [120, 6, 494, 4.81, "est", "nonmetal"],
  Br: [114, 7, 266, 3.1, "est", "nonmetal"], Kr: [202, 8, 116, 2.9, "est", "gas"],
  Rb: [248, 1, 312, 1.53, "ref", "metal"], Sr: [215, 2, 1050, 2.64, "ref", "metal"],
  Y: [180, 3, 1799, 4.47, "ref", "metal"], Zr: [160, 4, 2128, 6.51, "ref", "metal"],
  Nb: [146, 5, 2750, 8.57, "ref", "metal"], Mo: [139, 6, 2896, 10.28, "ref", "metal"],
  Tc: [136, 7, 2430, 11.5, "est", "radioactive"], Ru: [134, 8, 2607, 12.37, "ref", "metal"],
  Rh: [134, 9, 2237, 12.41, "ref", "metal"], Pd: [137, 10, 1828, 12.02, "ref", "metal"],
  Ag: [144, 11, 1235, 10.49, "ref", "metal"], Cd: [151, 12, 594, 8.65, "ref", "metal"],
  In: [167, 3, 430, 7.31, "ref", "metal"], Sn: [158, 4, 505, 7.29, "ref", "metal"],
  Sb: [145, 5, 904, 6.69, "est", "metalloid"], Te: [140, 6, 723, 6.24, "est", "metalloid"],
  I: [133, 7, 387, 4.93, "est", "nonmetal"], Xe: [216, 8, 161, 3.64, "est", "gas"],
  Cs: [265, 1, 302, 1.93, "ref", "metal"], Ba: [222, 2, 1000, 3.51, "ref", "metal"],
  La: [187, 3, 1193, 6.15, "ref", "metal"], Ce: [182, 3, 1068, 6.77, "ref", "metal"],
  Pr: [182, 3, 1208, 6.77, "ref", "metal"], Nd: [181, 3, 1297, 7.01, "ref", "metal"],
  Pm: [183, 3, 1315, 7.26, "est", "radioactive"], Sm: [180, 3, 1345, 7.52, "ref", "metal"],
  Eu: [204, 3, 1099, 5.24, "ref", "metal"], Gd: [180, 3, 1585, 7.9, "ref", "metal"],
  Tb: [178, 3, 1629, 8.23, "ref", "metal"], Dy: [177, 3, 1680, 8.55, "ref", "metal"],
  Ho: [176, 3, 1734, 8.8, "ref", "metal"], Er: [176, 3, 1802, 9.07, "ref", "metal"],
  Tm: [176, 3, 1818, 9.32, "ref", "metal"], Yb: [194, 3, 1097, 6.9, "ref", "metal"],
  Lu: [173, 3, 1925, 9.84, "ref", "metal"], Hf: [159, 4, 2506, 13.31, "ref", "metal"],
  Ta: [146, 5, 3290, 16.65, "ref", "metal"], W: [139, 6, 3695, 19.25, "ref", "metal"],
  Re: [137, 7, 3459, 21.02, "ref", "metal"], Os: [135, 8, 3306, 22.59, "ref", "metal"],
  Ir: [136, 9, 2719, 22.56, "ref", "metal"], Pt: [139, 10, 2041, 21.45, "ref", "metal"],
  Au: [144, 11, 1337, 19.3, "ref", "metal"], Hg: [151, 12, 234, 13.53, "est", "metal"],
  Tl: [170, 3, 577, 11.85, "ref", "metal"], Pb: [175, 4, 601, 11.34, "ref", "metal"],
  Bi: [170, 5, 544, 9.78, "ref", "metal"], Po: [168, 6, 527, 9.2, "est", "radioactive"],
  At: [150, 7, 575, 6.4, "est", "radioactive"], Rn: [220, 8, 202, 4.4, "est", "radioactive"],
  Fr: [270, 1, 300, 1.87, "est", "radioactive"], Ra: [223, 2, 973, 5.5, "est", "radioactive"],
  Ac: [188, 3, 1323, 10.07, "est", "radioactive"], Th: [180, 4, 2023, 11.72, "est", "radioactive"],
  Pa: [163, 5, 1841, 15.37, "est", "radioactive"], U: [156, 6, 1405, 19.05, "est", "radioactive"],
  Np: [155, 7, 917, 20.45, "est", "radioactive"], Pu: [159, 6, 913, 19.82, "est", "radioactive"],
  Am: [173, 3, 1449, 12, "est", "radioactive"], Cm: [174, 3, 1613, 13.51, "est", "radioactive"],
  Bk: [170, 3, 1259, 14.78, "est", "radioactive"], Cf: [186, 3, 1173, 15.1, "est", "radioactive"],
  Es: [186, 3, 1133, 8.84, "est", "radioactive"], Fm: [190, 3, 1800, 9.7, "est", "radioactive"],
  Md: [190, 3, 1100, 10.3, "est", "radioactive"], No: [190, 3, 1100, 9.9, "est", "radioactive"],
  Lr: [180, 3, 1900, 15.6, "est", "radioactive"],
  Rf: [150, 4, 2400, 23, "est", "radioactive"], Db: [139, 5, 2500, 29, "est", "radioactive"],
  Sg: [132, 6, 2600, 35, "est", "radioactive"], Bh: [128, 7, 2500, 37, "est", "radioactive"],
  Hs: [126, 8, 2400, 41, "est", "radioactive"], Mt: [128, 9, 2200, 37, "est", "radioactive"],
  Ds: [132, 10, 2000, 34, "est", "radioactive"], Rg: [138, 11, 1600, 28, "est", "radioactive"],
  Cn: [147, 12, 300, 14, "est", "radioactive"], Nh: [170, 3, 700, 16, "est", "radioactive"],
  Fl: [180, 4, 300, 11.4, "est", "radioactive"], Mc: [187, 5, 670, 13.5, "est", "radioactive"],
  Lv: [183, 6, 700, 12.9, "est", "radioactive"], Ts: [138, 7, 700, 7.2, "est", "radioactive"],
  Og: [157, 8, 325, 7.2, "est", "radioactive"],
};

function parseWeight(w: string): number {
  return Number(w.replace(/[()]/g, "")) || 0;
}

export const ELEMENT_PROPS: Record<string, ElementProps> = Object.fromEntries(
  ELEMENTS.filter((e) => RAW[e.symbol]).map((e) => {
    const [r, vec, tm, rho, quality, kind] = RAW[e.symbol];
    return [e.symbol, { symbol: e.symbol, name: e.name, A: parseWeight(e.weight), r, vec, tm, rho, quality, kind }];
  })
);

// Binary mixing enthalpy ΔH_AB (kJ/mol), Miedema model values (Takeuchi & Inoue 2005, 근사).
const PAIRS: [string, string, number][] = [
  // refractory set
  ["Ti", "Zr", 0], ["Ti", "Hf", 0], ["Ti", "Nb", 2], ["Ti", "Ta", 1], ["Ti", "Mo", -4],
  ["Ti", "W", -6], ["Ti", "V", -2], ["Ti", "Cr", -7], ["Ti", "Al", -30],
  ["Zr", "Hf", 0], ["Zr", "Nb", 4], ["Zr", "Ta", 3], ["Zr", "Mo", -6], ["Zr", "W", -9],
  ["Zr", "V", -4], ["Zr", "Cr", -12], ["Zr", "Al", -44],
  ["Hf", "Nb", 4], ["Hf", "Ta", 3], ["Hf", "Mo", -4], ["Hf", "W", -6], ["Hf", "V", -2],
  ["Hf", "Cr", -9], ["Hf", "Al", -39],
  ["Nb", "Ta", 0], ["Nb", "Mo", -6], ["Nb", "W", -8], ["Nb", "V", -1], ["Nb", "Cr", -7], ["Nb", "Al", -18],
  ["Ta", "Mo", -5], ["Ta", "W", -7], ["Ta", "V", -1], ["Ta", "Cr", -7], ["Ta", "Al", -19],
  ["Mo", "W", 0], ["Mo", "V", 0], ["Mo", "Cr", 0], ["Mo", "Al", -5],
  ["W", "V", -1], ["W", "Cr", 1], ["W", "Al", -2],
  ["V", "Cr", -2], ["V", "Al", -16], ["Cr", "Al", -10],
  // 3d transition metals (Cantor-type) and cross pairs
  ["Fe", "Co", -1], ["Fe", "Ni", -2], ["Fe", "Cr", -1], ["Fe", "Mn", 0], ["Fe", "Cu", 13],
  ["Co", "Ni", 0], ["Co", "Cr", -4], ["Co", "Mn", -5], ["Co", "Cu", 6],
  ["Ni", "Cr", -7], ["Ni", "Mn", -8], ["Ni", "Cu", 4], ["Cr", "Mn", 2], ["Cr", "Cu", 12], ["Mn", "Cu", 4],
  ["Al", "Fe", -11], ["Al", "Co", -19], ["Al", "Ni", -22], ["Al", "Cu", -1], ["Al", "Mn", -19],
  ["Ti", "Fe", -17], ["Ti", "Co", -28], ["Ti", "Ni", -35], ["Ti", "Cu", -9], ["Ti", "Mn", -8],
  ["V", "Fe", -7], ["V", "Co", -14], ["V", "Ni", -18], ["V", "Cu", 5], ["V", "Mn", -1],
  ["Zr", "Fe", -25], ["Zr", "Co", -41], ["Zr", "Ni", -49], ["Zr", "Cu", -23],
  ["Nb", "Fe", -16], ["Nb", "Co", -25], ["Nb", "Ni", -30], ["Nb", "Cu", 3],
  ["Mo", "Fe", -2], ["Mo", "Co", -5], ["Mo", "Ni", -7], ["Mo", "Cu", 19],
  ["Hf", "Fe", -21], ["Hf", "Co", -35], ["Hf", "Ni", -42],
  ["Ta", "Fe", -15], ["Ta", "Co", -24], ["Ta", "Ni", -29],
  ["W", "Fe", 0], ["W", "Co", -1], ["W", "Ni", -3],
];

const PAIR_MAP = new Map<string, number>();
for (const [a, b, h] of PAIRS) {
  PAIR_MAP.set(`${a}-${b}`, h);
  PAIR_MAP.set(`${b}-${a}`, h);
}

/** Returns null when the pair is not registered (treated as 0 in ΔHmix). */
export function mixingEnthalpy(a: string, b: string): number | null {
  return PAIR_MAP.get(`${a}-${b}`) ?? null;
}

export const DATA_SOURCES = [
  { item: "금속 반경 · VEC", source: "Guo et al., J. Appl. Phys. 109 (2011) 103505 외 표 값" },
  { item: "ΔHmix 이원계 값", source: "Takeuchi & Inoue, Mater. Trans. 46 (2005) 2817 — 등록된 쌍만, 나머지는 0으로 가정" },
  { item: "융점 · 밀도 · 원자량", source: "일반 물성 핸드북 값 (기체·방사성·초중원소는 추정치)" },
];
