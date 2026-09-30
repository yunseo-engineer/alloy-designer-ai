"use client";

import { useMemo, useState } from "react";
import { useResearchStore } from "@/store/useResearchStore";
import { useActiveRun, useThemeColors } from "@/lib/hooks";
import type { DSPoint, Targets } from "@/lib/designSpace";
import { LITERATURE, compositionDistance, formula, nearestLiterature } from "@/lib/literature";
import { PHASE_RULES, computeDescriptors } from "@/lib/descriptors";
import { PlotCanvas, type PlotLayer, type PlotPoint } from "@/components/ui/PlotCanvas";
import {
  Btn, EmptyState, Formula, PageHeader, Panel, PassMark, Segmented, Stat, StatList, Tag, downloadText, toCsv,
} from "@/components/ui/primitives";

type Filter = "pareto" | "target" | "pass" | "all";
type SortKey = "ys" | "el" | "unc" | "rho";
type PlotTab = "ysel" | "phase";

const tip = (p: DSPoint) => [
  formula(p.comp),
  `YS ${p.pred.ys} ± ${p.pred.ysCi} MPa · EL ${p.pred.el} ± ${p.pred.elCi} %`,
  `VEC ${p.d.vec.toFixed(2)} · δ ${p.d.delta.toFixed(2)} % · ρ ${p.d.rho.toFixed(2)}`,
];

/** Pick up to 3 candidates that are also compositionally distinct from each other. */
function diverse(sorted: DSPoint[], n = 3, minDist = 0.12) {
  const out: DSPoint[] = [];
  for (const p of sorted) {
    if (out.every((q) => compositionDistance(p.comp, q.comp) >= minDist)) out.push(p);
    if (out.length === n) break;
  }
  return out;
}

function recommend(points: DSPoint[], t: Targets) {
  const hits = points.filter((p) => p.meetsTarget);
  if (hits.length) {
    const score = (p: DSPoint) => Math.min(p.pred.ys / t.ys, p.pred.el / Math.max(1, t.el)) - 0.5 * p.pred.dMin;
    return { mode: "hit" as const, list: diverse([...hits].sort((a, b) => score(b) - score(a))) };
  }
  const gap = (p: DSPoint) => Math.max(0, 1 - p.pred.ys / t.ys) + Math.max(0, 1 - p.pred.el / Math.max(1, t.el));
  const pool = points.filter((p) => p.pareto);
  return { mode: "near" as const, list: diverse([...pool].sort((a, b) => gap(a) - gap(b))) };
}

export function Explore() {
  const { run, ds } = useActiveRun();
  const setView = useResearchStore((s) => s.setView);
  const specimens = useResearchStore((s) => s.specimens);
  const addSpecimen = useResearchStore((s) => s.addSpecimen);
  const theme = useResearchStore((s) => s.theme);
  const C = useThemeColors();

  const [selIdx, setSelIdx] = useState<number | null>(null);
  const [showLit, setShowLit] = useState(true);
  const [filter, setFilter] = useState<Filter>("pareto");
  const [sortKey, setSortKey] = useState<SortKey>("ys");
  const [tab, setTab] = useState<PlotTab>("ysel");
  const [limit, setLimit] = useState(12);

  const points = useMemo(() => ds?.points ?? [], [ds]);
  const t = run?.spec.targets;
  const rec = useMemo(() => (t ? recommend(points, t) : null), [points, t]);
  const sel = selIdx != null ? points[selIdx] : rec?.list[0] ?? null;

  const registered = useMemo(() => new Set(specimens.map((s) => formula(s.composition))), [specimens]);
  const isRegistered = (p: DSPoint) => registered.has(formula(p.comp));
  const originOf = (p: DSPoint) => (p.pareto ? "파레토 최적" : p.meetsTarget ? "목표 충족" : "탐색 공간 선택");

  const layersYsEl = useMemo<PlotLayer[]>(() => {
    const fail: PlotPoint[] = [], pass: PlotPoint[] = [], hit: PlotPoint[] = [];
    points.forEach((p) => {
      const pt: PlotPoint = { x: p.pred.el, y: p.pred.ys, color: "", key: p.idx, tooltip: tip(p) };
      if (!p.phasePass) fail.push({ ...pt, color: C.point, r: 1.8 });
      else if (p.meetsTarget) hit.push({ ...pt, color: C.success, r: 2.6 });
      else pass.push({ ...pt, color: C["point-pass"], r: 2.2 });
    });
    const pareto = points
      .filter((p) => p.pareto)
      .map<PlotPoint>((p) => ({ x: p.pred.el, y: p.pred.ys, color: C.text, r: 3.6, hollow: true, key: p.idx, tooltip: ["파레토 최적", ...tip(p)] }));
    const lit: PlotPoint[] = showLit
      ? LITERATURE.map((l) => ({
          x: l.el, y: l.ys, color: C["text-muted"], r: 3.5, shape: "square", hollow: true, label: l.id,
          tooltip: [`${l.id} · ${formula(l.composition)}`, `보고 YS ${l.ys} MPa · EL ${l.el} %`, `${l.phase} · ${l.condition}`],
        }))
      : [];
    const regs = points
      .filter((p) => registered.has(formula(p.comp)))
      .map<PlotPoint>((p) => ({ x: p.pred.el, y: p.pred.ys, color: C.text, r: 4.5, shape: "diamond", hollow: true, key: p.idx, tooltip: ["등록 시편", ...tip(p)] }));
    const selected: PlotPoint[] = sel
      ? [{ x: sel.pred.el, y: sel.pred.ys, color: C.text, r: 8, hollow: true, ex: sel.pred.elCi, ey: sel.pred.ysCi }]
      : [];
    return [
      { points: fail, interactive: true, alpha: 0.45 },
      { points: pass, interactive: true, alpha: 0.75 },
      { points: hit, interactive: true, alpha: 0.9 },
      { points: pareto, interactive: true },
      { points: lit, interactive: true },
      { points: regs, interactive: true },
      { points: selected },
    ];
  }, [points, showLit, registered, sel, C]);

  const paretoLine = useMemo(
    () =>
      points
        .filter((p) => p.pareto)
        .sort((a, b) => a.pred.el - b.pred.el)
        .map((p) => [p.pred.el, p.pred.ys] as [number, number]),
    [points]
  );

  const layersPhase = useMemo<PlotLayer[]>(() => {
    const fail: PlotPoint[] = [], pass: PlotPoint[] = [], hit: PlotPoint[] = [];
    points.forEach((p) => {
      const pt: PlotPoint = { x: p.d.vec, y: p.d.delta, color: "", key: p.idx, tooltip: tip(p) };
      if (!p.phasePass) fail.push({ ...pt, color: C.point, r: 1.8 });
      else if (p.meetsTarget) hit.push({ ...pt, color: C.success, r: 2.6 });
      else pass.push({ ...pt, color: C["point-pass"], r: 2.2 });
    });
    const lit: PlotPoint[] = showLit
      ? LITERATURE.map<PlotPoint>((l) => {
          const d = computeDescriptors(l.composition);
          return {
            x: d.vec, y: d.delta, color: l.phase === "BCC" ? C["text-muted"] : C.warning, r: 3.5, shape: "square", hollow: true, label: l.id,
            tooltip: [`${l.id} · ${formula(l.composition)}`, `보고 상: ${l.phase}`, `VEC ${d.vec.toFixed(2)} · δ ${d.delta.toFixed(2)} %`],
          };
        })
      : [];
    const selected: PlotPoint[] = sel ? [{ x: sel.d.vec, y: sel.d.delta, color: C.text, r: 8, hollow: true }] : [];
    return [
      { points: fail, interactive: true, alpha: 0.45 },
      { points: pass, interactive: true, alpha: 0.75 },
      { points: hit, interactive: true, alpha: 0.9 },
      { points: lit, interactive: true },
      { points: selected },
    ];
  }, [points, showLit, sel, C]);

  const filtered = useMemo(() => {
    const base = points.filter((p) =>
      filter === "pareto" ? p.pareto : filter === "target" ? p.meetsTarget : filter === "pass" ? p.phasePass : true
    );
    const key = (p: DSPoint) =>
      sortKey === "ys" ? -p.pred.ys : sortKey === "el" ? -p.pred.el : sortKey === "unc" ? p.pred.dMin : p.d.rho;
    return [...base].sort((a, b) => key(a) - key(b));
  }, [points, filter, sortKey]);

  if (!run || !ds || !t || !rec) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader index="3" title="탐색 공간" />
        <EmptyState
          title="아직 계산 결과가 없습니다"
          desc="설계 조건에서 계산을 실행하면 평가된 모든 조성이 이곳에 표시됩니다."
          action={<Btn variant="primary" onClick={() => setView("setup")}>설계 조건으로</Btn>}
        />
      </div>
    );
  }

  const s = ds.stats;
  const allYs = points.map((p) => p.pred.ys).concat(showLit && tab === "ysel" ? LITERATURE.map((l) => l.ys) : []);
  const ysMin = Math.max(0, Math.floor((Math.min(t.ys, ...allYs) - 100) / 100) * 100);
  const ysMax = Math.ceil((Math.max(t.ys, ...allYs) + 100) / 100) * 100;
  const elMax = Math.max(40, Math.ceil((Math.max(t.el, ...points.map((p) => p.pred.el)) + 5) / 5) * 5);
  const vecs = points.map((p) => p.d.vec);
  const deltas = points.map((p) => p.d.delta);
  const vecDom: [number, number] = [Math.min(3.5, Math.floor(Math.min(...vecs) * 2) / 2), Math.max(7.2, Math.ceil(Math.max(...vecs) * 2) / 2)];
  const deltaDom: [number, number] = [0, Math.max(9, Math.ceil(Math.max(...deltas) + 1))];

  const exportCsv = () => {
    const rows: (string | number)[][] = [
      ["formula", ...run.spec.elements.map((e) => `${e}_at%`), "VEC", "delta_%", "dHmix_kJmol", "dSmix_JKmol", "Omega", "Tm_K", "rho_gcm3",
        "YS_MPa", "YS_CI", "EL_%", "EL_CI", "d_min", "phase_rules_pass", "meets_target", "pareto"],
      ...points.map((p) => [
        formula(p.comp), ...run.spec.elements.map((e) => p.comp[e] ?? 0),
        p.d.vec.toFixed(3), p.d.delta.toFixed(3), p.d.dHmix.toFixed(3), p.d.dSmix.toFixed(3), p.d.omega.toFixed(2), p.d.tm.toFixed(0), p.d.rho.toFixed(3),
        p.pred.ys, p.pred.ysCi, p.pred.el, p.pred.elCi, p.pred.dMin.toFixed(3), p.phasePass ? 1 : 0, p.meetsTarget ? 1 : 0, p.pareto ? 1 : 0,
      ]),
    ];
    downloadText(`${run.id}_design_space.csv`, toCsv(rows), "text/csv");
  };

  const pick = (pt: PlotPoint) => {
    if (typeof pt.key === "number") setSelIdx(pt.key);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        index="3"
        title="탐색 공간"
        desc={`${run.id} · ${run.spec.elements.join("-")} · 목표 YS ≥ ${t.ys} MPa, EL ≥ ${t.el} %. 평가한 모든 조성 중에서 시편으로 만들 조성을 고르세요.`}
        right={<Btn onClick={exportCsv}>전체 데이터 CSV</Btn>}
      />

      <StatList className="mb-8">
        <Stat label="평가한 조성" value={s.total.toLocaleString()} sub={`${ds.step} at% 간격`} />
        <Stat label="고용체 규칙 통과" value={s.phasePass.toLocaleString()} sub={`전체의 ${((s.phasePass / Math.max(1, s.total)) * 100).toFixed(0)} %`} />
        <Stat label="목표 충족" value={s.meetsTarget.toLocaleString()} tone={s.meetsTarget ? "success" : undefined} sub="규칙 통과 + 목표 달성" />
        <Stat label="파레토 최적" value={s.pareto} sub="강도–연성 최선 경계" />
      </StatList>

      {s.phasePass === 0 && (
        <div className="mb-6 border-l-4 border-danger py-2 pl-4">
          <div className="text-sm font-semibold text-warning">고용체 판별 규칙을 통과한 조성이 없습니다</div>
          <p className="mt-1 text-sm text-text-muted">
            이 원소계에서는 BCC 고용체 형성이 어려울 것으로 판단됩니다. 가장 많이 걸린 규칙을 확인하고 원소 구성을 바꿔 보세요.
          </p>
          <ul className="mt-3 space-y-1 text-xs">
            {PHASE_RULES.map((r) => (
              <li key={r.key} className="flex justify-between gap-4 border-b border-border py-1.5">
                <div className="num">{r.criterion}</div>
                <div className="num text-text-muted">
                  제외 {(s.ruleFail[r.key] ?? 0).toLocaleString()} / {s.total.toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
          <Btn className="mt-4" onClick={() => setView("setup")}>설계 조건 수정</Btn>
        </div>
      )}

      {/* recommendations */}
      {rec.list.length > 0 && (
      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {rec.mode === "hit" ? "우선 검토 조성" : "목표에 가장 가까운 조성"}
          </h2>
          <span className="text-xs text-text-muted">
            {rec.mode === "hit" ? "목표 충족 조성 중 예측 여유가 크고 문헌 근거가 가까운 순" : "목표를 충족하는 조성이 없어 파레토 경계에서 목표에 가까운 순으로 표시"}
          </span>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th className="w-10">#</th>
              <th>조성 (at%)</th>
              <th className="text-right">YS (MPa)</th>
              <th className="text-right">EL (%)</th>
              <th className="text-right">ρ</th>
              <th className="text-right">d_min</th>
              <th>구분</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rec.list.map((p, i) => {
              const on = sel?.idx === p.idx;
              return (
                <tr
                  key={p.idx}
                  onClick={() => setSelIdx(p.idx)}
                  className="cursor-pointer"
                  style={on ? { background: "var(--color-accent-soft)" } : undefined}
                >
                  <td className="num text-text-muted">{i + 1}</td>
                  <td><Formula c={p.comp} className="text-base font-medium" /></td>
                  <td className="num text-right">{p.pred.ys} <span className="text-text-muted">±{p.pred.ysCi}</span></td>
                  <td className="num text-right">{p.pred.el} <span className="text-text-muted">±{p.pred.elCi}</span></td>
                  <td className="num text-right">{p.d.rho.toFixed(2)}</td>
                  <td className="num text-right">{p.pred.dMin.toFixed(2)}</td>
                  <td className="space-x-1 whitespace-nowrap">
                    {p.meetsTarget && <Tag tone="success">목표 충족</Tag>}
                    {p.pareto && <Tag tone="ink">파레토</Tag>}
                    {p.pred.extrapolated && <Tag tone="warning">외삽</Tag>}
                  </td>
                  <td className="text-right">
                    <Btn
                      variant={isRegistered(p) ? "default" : "primary"}
                      disabled={isRegistered(p)}
                      onClick={() => addSpecimen(p.comp, originOf(p), run.id)}
                    >
                      {isRegistered(p) ? "등록됨" : "시편 등록"}
                    </Btn>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      )}

      {/* plot + detail */}
      <div className="mb-8 space-y-8">
        <div className="min-w-0 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
            <Segmented<PlotTab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "ysel", label: "강도 – 연성" },
                { value: "phase", label: "상 형성 맵 (VEC – δ)" },
              ]}
            />
            <label className="flex items-center gap-1.5 text-xs text-text-muted">
              <input type="checkbox" checked={showLit} onChange={(e) => setShowLit(e.target.checked)} />
              문헌 보고값 표시
            </label>
          </div>
          {tab === "ysel" ? (
            <PlotCanvas
              bare
              title="예측 항복강도 – 연신율"
              xLabel="예측 연신율 EL (%)"
              yLabel="예측 항복강도 YS (MPa)"
              xDomain={[0, elMax]}
              yDomain={[ysMin, ysMax]}
              layers={layersYsEl}
              region={{ x0: t.el, x1: elMax, y0: t.ys, y1: ysMax, label: "목표 영역" }}
              polyline={{ pts: paretoLine, color: C.text }}
              fileName={`${run.id}_ys_el`}
              themeKey={theme}
              onPick={pick}
              height={400}
              legend={[
                { color: C.point, label: "규칙 미통과" },
                { color: C["point-pass"], label: "규칙 통과" },
                { color: C.success, label: "목표 충족" },
                { color: C.text, label: "파레토 최적 (선)", hollow: true },
                { color: C["text-muted"], label: "문헌", shape: "square", hollow: true },
                { color: C.text, label: "등록 시편", hollow: true },
              ]}
            />
          ) : (
            <PlotCanvas
              bare
              title="상 형성 맵"
              xLabel="VEC"
              yLabel="δ (%)"
              xDomain={vecDom}
              yDomain={deltaDom}
              layers={layersPhase}
              vLines={[{ x: 6.87, label: "VEC 6.87 (Guo 2011)" }]}
              hLines={[{ y: 6.6, label: "δ 6.6 % (Yang & Zhang 2012)" }]}
              fileName={`${run.id}_phase_map`}
              themeKey={theme}
              onPick={pick}
              height={400}
              legend={[
                { color: C.point, label: "규칙 미통과" },
                { color: C["point-pass"], label: "규칙 통과" },
                { color: C.success, label: "목표 충족" },
                { color: C["text-muted"], label: "문헌 · BCC 단상", shape: "square", hollow: true },
                { color: C.warning, label: "문헌 · 2상 이상", shape: "square", hollow: true },
              ]}
            />
          )}
        </div>

        <aside className="border-t border-border pt-4">
          {sel ? (
            <>
              <div className="mb-1 text-xs text-text-muted">선택한 조성</div>
              <Formula c={sel.comp} className="text-lg font-medium" />
              <div className="mt-2 flex flex-wrap gap-1">
                {sel.meetsTarget && <Tag tone="success">목표 충족</Tag>}
                {sel.pareto && <Tag tone="ink">파레토</Tag>}
                {!sel.phasePass && <Tag tone="danger">규칙 미통과</Tag>}
                {sel.pred.extrapolated && <Tag tone="warning">외삽</Tag>}
              </div>

              <div className="mt-4 space-y-3">
                <Meter label="항복강도" v={sel.pred.ys} ci={sel.pred.ysCi} target={t.ys} unit="MPa" />
                <Meter label="연신율" v={sel.pred.el} ci={sel.pred.elCi} target={t.el} unit="%" />
              </div>

              <div className="mt-4 border-t border-border pt-3">
                <div className="mb-1.5 text-xs font-medium">고용체 판별</div>
                <ul className="space-y-1 text-xs">
                  {PHASE_RULES.map((r) => (
                    <li key={r.key} className="flex items-center justify-between">
                      <span className="num text-text-muted">{r.criterion.replace(" (BCC 안정)", "")}</span>
                      <span className="flex items-center gap-2">
                        <span className="num">
                          {r.key === "vec" ? sel.d.vec.toFixed(2) : r.key === "delta" ? sel.d.delta.toFixed(2) : r.key === "omega" ? (sel.d.omega > 100 ? ">100" : sel.d.omega.toFixed(1)) : sel.d.dHmix.toFixed(1)}
                        </span>
                        <PassMark pass={sel.rules[r.key]} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-4 border-t border-border pt-3">
                <div className="mb-1.5 text-xs font-medium">가까운 문헌 조성</div>
                <ul className="space-y-1 text-xs">
                  {nearestLiterature(sel.comp, 2).map(({ entry, distance }) => (
                    <li key={entry.id} className="flex items-center justify-between gap-2">
                      <Formula c={entry.composition} />
                      <span className="num text-text-muted">
                        {entry.ys}/{entry.el} · d {distance.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <Btn
                variant="primary"
                size="md"
                className="mt-4 w-full"
                disabled={isRegistered(sel)}
                onClick={() => addSpecimen(sel.comp, originOf(sel), run.id)}
              >
                {isRegistered(sel) ? "시편으로 등록됨" : "이 조성을 시편으로 등록"}
              </Btn>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-text-muted">그래프의 점이나 목록의 행을 클릭하면 상세 정보가 표시됩니다.</p>
          )}
        </aside>
      </div>

      {/* table */}
      <Panel
        title="조성 목록"
        right={
          <>
            <Segmented<Filter>
              value={filter}
              onChange={(v) => {
                setFilter(v);
                setLimit(12);
              }}
              options={[
                { value: "pareto", label: `파레토 ${s.pareto}` },
                { value: "target", label: `목표 충족 ${s.meetsTarget}` },
                { value: "pass", label: `규칙 통과 ${s.phasePass}` },
                { value: "all", label: `전체 ${s.total}` },
              ]}
            />
            <select className="field h-8 text-xs" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
              <option value="ys">YS 높은 순</option>
              <option value="el">EL 높은 순</option>
              <option value="unc">불확실도 낮은 순</option>
              <option value="rho">밀도 낮은 순</option>
            </select>
          </>
        }
        bodyClass="pt-2"
      >
        <table className="dtable">
          <thead>
            <tr>
              <th>조성 (at%)</th>
              <th className="text-right">YS (MPa)</th>
              <th className="text-right">EL (%)</th>
              <th className="text-right">VEC</th>
              <th className="text-right">δ (%)</th>
              <th className="text-right">ρ (g/cm³)</th>
              <th className="text-right">d_min</th>
              <th>구분</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((p) => (
              <tr
                key={p.idx}
                onClick={() => setSelIdx(p.idx)}
                className="cursor-pointer"
                style={p.idx === sel?.idx ? { background: "var(--color-accent-soft)" } : undefined}
              >
                <td><Formula c={p.comp} /></td>
                <td className="num text-right">{p.pred.ys} <span className="text-text-muted">±{p.pred.ysCi}</span></td>
                <td className="num text-right">{p.pred.el} <span className="text-text-muted">±{p.pred.elCi}</span></td>
                <td className="num text-right">{p.d.vec.toFixed(2)}</td>
                <td className="num text-right">{p.d.delta.toFixed(2)}</td>
                <td className="num text-right">{p.d.rho.toFixed(2)}</td>
                <td className="num text-right" style={{ color: p.pred.extrapolated ? "var(--color-warning)" : undefined }}>
                  {p.pred.dMin.toFixed(2)}
                </td>
                <td className="space-x-1 whitespace-nowrap">
                  {p.pareto && <Tag tone="ink">파레토</Tag>}
                  {p.meetsTarget && <Tag tone="success">목표</Tag>}
                  {!p.phasePass && <Tag tone="danger">규칙 X</Tag>}
                </td>
                <td className="text-right">
                  <button
                    disabled={isRegistered(p)}
                    onClick={(e) => {
                      e.stopPropagation();
                      addSpecimen(p.comp, originOf(p), run.id);
                    }}
                    className="whitespace-nowrap text-xs font-medium text-accent disabled:font-normal disabled:text-text-muted"
                  >
                    {isRegistered(p) ? "등록됨" : "+ 등록"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="py-8 text-center text-sm text-text-muted">조건에 맞는 조성이 없습니다.</p>}
        <div className="mt-2 flex items-center justify-between px-2 text-xs text-text-muted">
          <span>
            {Math.min(limit, filtered.length)} / {filtered.length.toLocaleString()}개 표시 · d_min: 가장 가까운 문헌 조성과의 거리 (0.30 초과 = 외삽)
          </span>
          {limit < filtered.length && (
            <Btn onClick={() => setLimit((l) => l + 30)}>더 보기</Btn>
          )}
        </div>
      </Panel>
    </div>
  );
}

function Meter({ label, v, ci, target, unit }: { label: string; v: number; ci: number; target: number; unit: string }) {
  const ok = v >= target;
  return (
    <div className="flex items-baseline justify-between border-b border-border pb-2 last:border-0">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="num text-right text-sm">
        <span className="font-medium">{v}</span> <span className="text-text-muted">± {ci} {unit}</span>
        <span className="ml-2 text-[0.6875rem] text-text-muted">목표 {target}</span>
        <span className="ml-1.5 text-[0.6875rem] font-medium" style={{ color: ok ? "var(--color-text)" : "var(--color-danger)" }}>
          {ok ? "충족" : "미달"}
        </span>
      </span>
    </div>
  );
}
