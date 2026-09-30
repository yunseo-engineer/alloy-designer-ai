import { ELEMENT_PROPS, mixingEnthalpy } from "./elementData";

/** Composition in at%, keys are element symbols. Values should sum to 100. */
export type Composition = Record<string, number>;

export interface Descriptors {
  vec: number;
  delta: number; // %
  dHmix: number; // kJ/mol
  dSmix: number; // J/(K·mol)
  omega: number;
  tm: number; // K (rule of mixtures)
  rho: number; // g/cm3
  missingPairs: string[]; // element pairs without ΔH data (assumed 0)
  estElements: string[]; // elements whose properties are estimates
}

const R = 8.314;

export function fractions(c: Composition): [string, number][] {
  const entries = Object.entries(c).filter(([, v]) => v > 0);
  const sum = entries.reduce((s, [, v]) => s + v, 0) || 1;
  return entries.map(([k, v]) => [k, v / sum]);
}

export function computeDescriptors(c: Composition): Descriptors {
  const x = fractions(c);
  let vec = 0;
  let rBar = 0;
  let tm = 0;
  let mass = 0;
  let volume = 0;
  let dSmix = 0;
  for (const [el, xi] of x) {
    const p = ELEMENT_PROPS[el];
    vec += xi * p.vec;
    rBar += xi * p.r;
    tm += xi * p.tm;
    mass += xi * p.A;
    volume += (xi * p.A) / p.rho;
    dSmix -= R * xi * Math.log(xi);
  }
  let d2 = 0;
  for (const [el, xi] of x) {
    const p = ELEMENT_PROPS[el];
    d2 += xi * Math.pow(1 - p.r / rBar, 2);
  }
  const delta = 100 * Math.sqrt(d2);
  let dHmix = 0;
  const missingPairs: string[] = [];
  for (let i = 0; i < x.length; i++) {
    for (let j = i + 1; j < x.length; j++) {
      const h = mixingEnthalpy(x[i][0], x[j][0]);
      if (h == null) missingPairs.push(`${x[i][0]}-${x[j][0]}`);
      dHmix += 4 * (h ?? 0) * x[i][1] * x[j][1];
    }
  }
  const estElements = x.map(([el]) => el).filter((el) => ELEMENT_PROPS[el].quality === "est");
  const omega = Math.abs(dHmix) < 1e-6 ? 999 : (tm * dSmix) / (Math.abs(dHmix) * 1000);
  return { vec, delta, dHmix, dSmix, omega, tm, rho: mass / volume, missingPairs, estElements };
}

export interface PhaseRule {
  key: "vec" | "delta" | "omega" | "dHmix";
  label: string;
  criterion: string;
  source: string;
  formula: string;
  test: (d: Descriptors) => boolean;
}

export const PHASE_RULES: PhaseRule[] = [
  {
    key: "vec",
    label: "VEC",
    criterion: "VEC < 6.87 (BCC 안정)",
    source: "Guo et al., J. Appl. Phys. 109 (2011) 103505",
    formula: "VEC = Σ cᵢ·VECᵢ",
    test: (d) => d.vec < 6.87,
  },
  {
    key: "delta",
    label: "δ",
    criterion: "δ ≤ 6.6 %",
    source: "Yang & Zhang, Mater. Chem. Phys. 132 (2012) 233",
    formula: "δ = 100·√(Σ cᵢ(1 − rᵢ/r̄)²),  r̄ = Σ cᵢrᵢ",
    test: (d) => d.delta <= 6.6,
  },
  {
    key: "omega",
    label: "Ω",
    criterion: "Ω ≥ 1.1",
    source: "Yang & Zhang, Mater. Chem. Phys. 132 (2012) 233",
    formula: "Ω = Tm·ΔSmix / |ΔHmix|,  Tm = Σ cᵢTmᵢ",
    test: (d) => d.omega >= 1.1,
  },
  {
    key: "dHmix",
    label: "ΔHmix",
    criterion: "−22 ≤ ΔHmix ≤ 7 kJ/mol",
    source: "Guo & Liu, Prog. Nat. Sci. 21 (2011) 433",
    formula: "ΔHmix = Σ_{i<j} 4·ΔH_ij·cᵢcⱼ",
    test: (d) => d.dHmix >= -22 && d.dHmix <= 7,
  },
];

export const DSMIX_FORMULA = "ΔSmix = −R·Σ cᵢ ln cᵢ";
export const RHO_FORMULA = "ρ = Σ cᵢAᵢ / Σ (cᵢAᵢ/ρᵢ)";

export function ruleResults(d: Descriptors): Record<PhaseRule["key"], boolean> {
  return {
    vec: PHASE_RULES[0].test(d),
    delta: PHASE_RULES[1].test(d),
    omega: PHASE_RULES[2].test(d),
    dHmix: PHASE_RULES[3].test(d),
  };
}

/** Convert at% to wt%. */
export function toWeightPercent(c: Composition): Record<string, number> {
  const x = fractions(c);
  const total = x.reduce((s, [el, xi]) => s + xi * ELEMENT_PROPS[el].A, 0);
  return Object.fromEntries(x.map(([el, xi]) => [el, (100 * xi * ELEMENT_PROPS[el].A) / total]));
}
