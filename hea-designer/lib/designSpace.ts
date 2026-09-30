import { computeDescriptors, ruleResults, type Composition, type Descriptors } from "./descriptors";
import { predict, type Prediction } from "./model";

export interface ElementRange {
  min: number;
  max: number;
}

export interface Targets {
  ys: number;
  el: number;
  rhoMax: number | null;
  useTemp: number;
}

export interface DesignSpec {
  elements: string[];
  rangeMode: "auto" | "custom";
  ranges: Record<string, ElementRange>;
  step: number;
  targets: Targets;
  hypothesis: string;
}

export interface DSPoint {
  idx: number;
  comp: Composition;
  d: Descriptors;
  pred: Prediction;
  rules: ReturnType<typeof ruleResults>;
  phasePass: boolean;
  meetsTarget: boolean;
  pareto: boolean;
}

export interface DSResult {
  points: DSPoint[];
  step: number;
  stats: {
    total: number;
    ruleFail: Record<string, number>;
    phasePass: number;
    meetsTarget: number;
    pareto: number;
    ms: number;
  };
}

const MAX_POINTS = 40000;

/** Enumerate compositions on an at% grid. Returns null if it exceeds the cap. */
function enumerateGrid(elements: string[], ranges: Record<string, ElementRange>, step: number, cap: number) {
  const out: Composition[] = [];
  const vals = elements.map((e) => {
    const r = ranges[e] ?? { min: 0, max: 100 };
    const lo = Math.ceil(r.min / step) * step;
    const hi = Math.floor(r.max / step) * step;
    return { lo, hi };
  });
  const cur: number[] = new Array(elements.length).fill(0);
  let overflow = false;

  const rec = (i: number, remaining: number) => {
    if (overflow) return;
    if (i === elements.length - 1) {
      const v = Math.round(remaining * 1000) / 1000;
      if (v >= vals[i].lo - 1e-9 && v <= vals[i].hi + 1e-9) {
        cur[i] = v;
        const comp: Composition = {};
        elements.forEach((e, k) => {
          if (cur[k] > 0) comp[e] = cur[k];
        });
        if (Object.keys(comp).length >= 2) out.push(comp);
        if (out.length > cap) overflow = true;
      }
      return;
    }
    for (let v = vals[i].lo; v <= vals[i].hi + 1e-9 && v <= remaining + 1e-9; v += step) {
      cur[i] = Math.round(v * 1000) / 1000;
      rec(i + 1, remaining - v);
    }
  };
  rec(0, 100);
  return overflow ? null : out;
}

export function countGrid(spec: Pick<DesignSpec, "elements" | "ranges" | "step">): number | null {
  if (spec.elements.length < 2) return 0;
  const g = enumerateGrid(spec.elements, spec.ranges, spec.step, MAX_POINTS);
  return g ? g.length : null;
}

export function feasibility(spec: Pick<DesignSpec, "elements" | "ranges">): string | null {
  if (spec.elements.length < 2) return "원소를 2개 이상 선택하세요.";
  const minSum = spec.elements.reduce((s, e) => s + (spec.ranges[e]?.min ?? 0), 0);
  const maxSum = spec.elements.reduce((s, e) => s + (spec.ranges[e]?.max ?? 0), 0);
  if (minSum > 100) return `최소 at% 합이 ${minSum}%로 100%를 넘습니다.`;
  if (maxSum < 100) return `최대 at% 합이 ${maxSum}%로 100%에 못 미칩니다.`;
  for (const e of spec.elements) {
    const r = spec.ranges[e];
    if (r && r.min > r.max) return `${e}: 최소값이 최대값보다 큽니다.`;
  }
  return null;
}

export function evaluate(comp: Composition, targets: Targets) {
  const d = computeDescriptors(comp);
  const pred = predict(comp, d);
  const rules = ruleResults(d);
  const phasePass = rules.vec && rules.delta && rules.omega && rules.dHmix;
  const meetsTarget =
    phasePass &&
    pred.ys >= targets.ys &&
    pred.el >= targets.el &&
    (targets.rhoMax == null || d.rho <= targets.rhoMax);
  return { d, pred, rules, phasePass, meetsTarget };
}

const cache = new Map<string, DSResult>();

export function computeDesignSpace(spec: DesignSpec, cacheKey?: string): DSResult {
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey)!;
  const t0 = performance.now();
  const grid = enumerateGrid(spec.elements, spec.ranges, spec.step, MAX_POINTS) ?? [];

  const ruleFail: Record<string, number> = { vec: 0, delta: 0, omega: 0, dHmix: 0 };
  const points: DSPoint[] = grid.map((comp, idx) => {
    const r = evaluate(comp, spec.targets);
    (Object.keys(r.rules) as (keyof typeof r.rules)[]).forEach((k) => {
      if (!r.rules[k]) ruleFail[k] += 1;
    });
    return { idx, comp, ...r, pareto: false };
  });

  // Pareto front (maximise YS and EL) among phase-rule-passing points.
  const pass = points.filter((p) => p.phasePass).sort((a, b) => b.pred.ys - a.pred.ys || b.pred.el - a.pred.el);
  let bestEl = -Infinity;
  for (const p of pass) {
    if (p.pred.el > bestEl) {
      p.pareto = true;
      bestEl = p.pred.el;
    }
  }

  const result: DSResult = {
    points,
    step: spec.step,
    stats: {
      total: points.length,
      ruleFail,
      phasePass: pass.length,
      meetsTarget: points.filter((p) => p.meetsTarget).length,
      pareto: points.filter((p) => p.pareto).length,
      ms: Math.max(1, Math.round(performance.now() - t0)),
    },
  };
  if (cacheKey) cache.set(cacheKey, result);
  return result;
}

/** HEA-convention default range per element, by number of elements. */
export function autoRange(n: number): ElementRange {
  if (n <= 2) return { min: 10, max: 90 };
  if (n === 3) return { min: 5, max: 60 };
  if (n === 4) return { min: 5, max: 45 };
  return { min: n * 5 <= 100 ? 5 : 0, max: 35 };
}

const AUTO_STEPS = [2.5, 5, 10, 20];
const AUTO_TARGET = 12000;

/** Resolve auto ranges / step into a concrete spec (what a Run actually evaluates). */
export function resolveSpec(spec: DesignSpec): DesignSpec & { count: number | null } {
  if (spec.elements.length < 2) return { ...spec, count: 0 };
  if (spec.rangeMode === "custom") {
    return { ...spec, count: countGrid(spec) };
  }
  const r = autoRange(spec.elements.length);
  const ranges = Object.fromEntries(spec.elements.map((e) => [e, { ...r }]));
  let best: { step: number; count: number } | null = null;
  for (const step of AUTO_STEPS) {
    const g = enumerateGrid(spec.elements, ranges, step, AUTO_TARGET);
    if (g && g.length > 0) {
      best = { step, count: g.length };
      break;
    }
  }
  return best
    ? { ...spec, ranges, step: best.step, count: best.count }
    : { ...spec, ranges, step: 20, count: countGrid({ elements: spec.elements, ranges, step: 20 }) };
}
