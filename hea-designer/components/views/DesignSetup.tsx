"use client";

import { useMemo, useState } from "react";
import { ELEMENTS, PLACEHOLDER_CELLS, type Category } from "@/mock/elements";
import { ELEMENT_PROPS, DATA_SOURCES } from "@/lib/elementData";
import { feasibility, resolveSpec } from "@/lib/designSpace";
import { PHASE_RULES } from "@/lib/descriptors";
import { useResearchStore } from "@/store/useResearchStore";
import { Btn, NumInput, PageHeader, Panel } from "@/components/ui/primitives";

const PRESETS: { label: string; elements: string[] }[] = [
  { label: "TiZrHfNbTa", elements: ["Ti", "Zr", "Hf", "Nb", "Ta"] },
  { label: "TiNbTaZrMo", elements: ["Ti", "Nb", "Ta", "Zr", "Mo"] },
  { label: "TiZrNbVAl", elements: ["Ti", "Zr", "Nb", "V", "Al"] },
  { label: "WMoTaNb", elements: ["W", "Mo", "Ta", "Nb"] },
  { label: "FeCoNiCrMn", elements: ["Fe", "Co", "Ni", "Cr", "Mn"] },
];

const gridRow = (row: number) => (row <= 7 ? row : row + 1);

// Element families — distinguished by shade/texture only (palette stays ink · gray · blue · red).
type Family = "alkali" | "transition" | "post" | "fblock" | "metalloid" | "nonmetal" | "unknown";
const FAMILY_OF: Record<Category, Family> = {
  alkali: "alkali",
  "alkaline-earth": "alkali",
  transition: "transition",
  "post-transition": "post",
  lanthanide: "fblock",
  actinide: "fblock",
  metalloid: "metalloid",
  "reactive-nonmetal": "nonmetal",
  "noble-gas": "nonmetal",
  unknown: "unknown",
};
const FAMILY: Record<Family, { label: string; style: React.CSSProperties }> = {
  alkali: { label: "알칼리·알칼리토 금속", style: { background: "var(--color-surface-2)" } },
  transition: { label: "전이 금속", style: { background: "var(--color-surface)" } },
  post: { label: "전이후 금속", style: { background: "color-mix(in srgb, var(--color-text) 11%, var(--color-surface))" } },
  fblock: { label: "란타넘·악티늄족", style: { background: "var(--color-accent-soft)" } },
  metalloid: {
    label: "준금속",
    style: {
      background:
        "repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-text) 12%, transparent) 0 2px, var(--color-surface) 2px 6px)",
    },
  },
  nonmetal: { label: "비금속·비활성 기체", style: { background: "transparent", borderStyle: "dashed" } },
  unknown: { label: "미확인 (초중원소)", style: { background: "transparent", borderStyle: "dotted" } },
};
const FAMILY_ORDER: Family[] = ["alkali", "transition", "post", "fblock", "metalloid", "nonmetal", "unknown"];
const CAT_BY_SYMBOL = Object.fromEntries(ELEMENTS.map((e) => [e.symbol, e.category]));

export function DesignSetup() {
  const draft = useResearchStore((s) => s.draft);
  const runs = useResearchStore((s) => s.runs);
  const toggleElement = useResearchStore((s) => s.toggleElement);
  const setElements = useResearchStore((s) => s.setElements);
  const setRange = useResearchStore((s) => s.setRange);
  const setRangeMode = useResearchStore((s) => s.setRangeMode);
  const setDraft = useResearchStore((s) => s.setDraft);
  const setTargets = useResearchStore((s) => s.setTargets);
  const startRun = useResearchStore((s) => s.startRun);
  const [hover, setHover] = useState<string | null>(null);

  const custom = draft.rangeMode === "custom";
  const problem = custom ? feasibility(draft) : draft.elements.length < 2 ? "원소를 2개 이상 선택하세요." : null;
  const resolved = useMemo(() => (problem ? null : resolveSpec(draft)), [draft, problem]);
  const count = resolved?.count ?? null;
  const nextRunId = `R-${String(runs.length + 1).padStart(3, "0")}`;
  const canRun = !problem && count != null && count > 0;
  const warnEst = draft.elements.filter((e) => ELEMENT_PROPS[e]?.quality === "est");

  const info = hover ? ELEMENT_PROPS[hover] : null;
  const autoR = resolved && !custom ? resolved.ranges[draft.elements[0]] : null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        index="1"
        title="설계 조건"
        desc="원소를 고르고 목표 물성을 정하면, 가능한 조성 조합을 자동으로 만들어 평가합니다."
      />

      <div className="space-y-8">
        {/* ---------------- periodic table ---------------- */}
        <Panel
          title="원소 선택"
          desc="주기율표에서 합금에 넣을 원소를 클릭하세요."
          right={
            draft.elements.length > 0 && (
              <Btn variant="ghost" onClick={() => setElements([])}>
                전체 해제
              </Btn>
            )
          }
        >
          <div className="mb-4 flex min-h-9 flex-wrap items-center gap-1.5">
            {draft.elements.length === 0 ? (
              <>
                <span className="mr-1 text-xs text-text-muted">빠른 시작</span>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setElements(p.elements)}
                    className="num rounded-full border border-border px-3 py-1 text-xs hover:border-accent hover:text-accent"
                  >
                    {p.label}
                  </button>
                ))}
              </>
            ) : (
              draft.elements.map((e) => (
                <span
                  key={e}
                  className="fade-up inline-flex items-center gap-1.5 rounded-full bg-accent py-1 pl-2.5 pr-1.5 text-sm font-medium text-white"
                >
                  {e}
                  <button
                    onClick={() => toggleElement(e)}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[0.6875rem] hover:bg-black/20"
                    aria-label={`${e} 제거`}
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>

          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: "repeat(18, minmax(0, 1fr))", gridTemplateRows: "repeat(7, auto) 8px repeat(2, auto)" }}
            onMouseLeave={() => setHover(null)}
          >
            {ELEMENTS.map((e) => {
              const p = ELEMENT_PROPS[e.symbol];
              const idx = draft.elements.indexOf(e.symbol);
              const on = idx >= 0;
              const est = p?.quality === "est";
              return (
                <button
                  key={e.symbol}
                  onClick={() => toggleElement(e.symbol)}
                  onMouseEnter={() => setHover(e.symbol)}
                  title={`${e.name} · ${FAMILY[FAMILY_OF[e.category]].label}${est ? " · 추정 물성" : ""}`}
                  style={{
                    gridRow: gridRow(e.row),
                    gridColumn: e.col,
                    ...(on ? {} : FAMILY[FAMILY_OF[e.category]].style),
                  }}
                  className={`flex aspect-square flex-col items-center justify-center rounded-md border leading-none transition ${
                    on
                      ? "border-accent bg-accent text-white"
                      : `border-border hover:border-accent ${est ? "text-text-muted" : ""}`
                  }`}
                >
                  <span className="num text-[0.5rem] opacity-60">{e.number}</span>
                  <span className="text-[0.8125rem] font-semibold">{e.symbol}</span>
                </button>
              );
            })}
            {PLACEHOLDER_CELLS.map((p) => (
              <div
                key={p.label}
                style={{ gridRow: gridRow(p.row), gridColumn: p.col }}
                className="num flex items-center justify-center text-[0.5625rem] text-text-muted"
              >
                {p.label}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-text-muted">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {FAMILY_ORDER.map((f) => (
                <span key={f} className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm border border-border" style={FAMILY[f].style} /> {FAMILY[f].label}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <span className="font-semibold text-text-muted">Xx</span> 흐린 글자 = 추정 물성
              </span>
            </div>
            <div className="num min-h-4">
              {info ? (
                <>
                  <span className="font-semibold text-text">{info.symbol}</span> {info.name} ·{" "}
                  {FAMILY[FAMILY_OF[CAT_BY_SYMBOL[info.symbol] as Category]].label} · r {info.r} pm · VEC {info.vec} · Tm{" "}
                  {info.tm} K · ρ {info.rho}
                </>
              ) : (
                "원소에 마우스를 올리면 물성이 표시됩니다"
              )}
            </div>
          </div>
        </Panel>

        {/* ---------------- targets · hypothesis · run (single column) ---------------- */}
        <div className="space-y-8">
          <Panel title="목표 물성">
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  항복강도 <span className="text-text-muted">YS</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-text-muted">≥</span>
                  <NumInput size="lg" width="w-28" value={draft.targets.ys} step={10} onChange={(v) => setTargets({ ys: v ?? 0 })} />
                  <span className="w-10 text-xs text-text-muted">MPa</span>
                </span>
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  연신율 <span className="text-text-muted">EL</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-text-muted">≥</span>
                  <NumInput size="lg" width="w-28" value={draft.targets.el} onChange={(v) => setTargets({ el: v ?? 0 })} />
                  <span className="w-10 text-xs text-text-muted">%</span>
                </span>
              </label>
              <details className="group text-xs">
                <summary className="cursor-pointer list-none text-text-muted hover:text-text">
                  <span className="inline-block transition group-open:rotate-90">›</span> 추가 제약 (선택)
                </summary>
                <div className="mt-3 space-y-2">
                  <label className="flex items-center justify-between">
                    <span>밀도 상한</span>
                    <span className="flex items-center gap-2">
                      <NumInput value={draft.targets.rhoMax} step={0.1} allowEmpty placeholder="없음" onChange={(v) => setTargets({ rhoMax: v })} />
                      <span className="w-10 text-text-muted">g/cm³</span>
                    </span>
                  </label>
                  <label className="flex items-center justify-between">
                    <span>사용 온도</span>
                    <span className="flex items-center gap-2">
                      <NumInput value={draft.targets.useTemp} step={25} onChange={(v) => setTargets({ useTemp: v ?? 25 })} />
                      <span className="w-10 text-text-muted">°C</span>
                    </span>
                  </label>
                </div>
              </details>
            </div>
          </Panel>

          <Panel title="연구 가설" desc="선택 사항 · Run과 함께 연구 노트에 기록됩니다.">
            <textarea
              value={draft.hypothesis}
              onChange={(e) => setDraft({ hypothesis: e.target.value })}
              rows={3}
              placeholder="예: Mo ≤ 5 at%에서 연신율 30 %를 유지하며 YS 1,050 MPa 이상 확보 가능한지"
              className="field w-full resize-y text-sm"
            />
          </Panel>

          <div className="border-t border-border pt-4">
            <div className="mb-3 space-y-1 text-xs">
              {problem ? (
                <div className="text-text-muted">{problem}</div>
              ) : (
                <>
                  <div className="text-sm font-medium">{draft.elements.join(" · ")}</div>
                  <div className="text-text-muted">
                    {custom ? "직접 지정한 조성 범위" : `조성 자동 설정 · 원소별 ${autoR?.min}–${autoR?.max} at%`} ·{" "}
                    {resolved?.step} at% 간격 ·{" "}
                    <span className="num text-text">{count == null ? "> 40,000" : count.toLocaleString()}</span>개 조성
                  </div>
                  {warnEst.length > 0 && (
                    <div className="text-warning">추정 물성 원소 포함: {warnEst.join(", ")} — 결과 신뢰도가 낮습니다.</div>
                  )}
                </>
              )}
            </div>
            <Btn variant="primary" size="lg" disabled={!canRun} onClick={startRun} className="w-full">
              계산 실행 <span className="num text-xs opacity-80">{nextRunId}</span>
            </Btn>
          </div>

          <details className="group border-t border-border pt-4 text-xs" open={custom}>
            <summary className="flex cursor-pointer list-none items-center justify-between">
              <span className="font-medium">고급 설정</span>
              <span className="text-text-muted">조성 범위 · 판별 규칙</span>
            </summary>
            <div className="mt-3 space-y-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={custom} onChange={(e) => setRangeMode(e.target.checked ? "custom" : "auto")} />
                조성 범위를 직접 지정
              </label>
              {custom && draft.elements.length > 0 && (
                <div>
                  <table className="dtable">
                    <thead>
                      <tr>
                        <th>원소</th>
                        <th className="text-right">최소 at%</th>
                        <th className="text-right">최대 at%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.elements.map((e) => {
                        const r = draft.ranges[e] ?? { min: 0, max: 100 };
                        return (
                          <tr key={e}>
                            <td className="font-medium">{e}</td>
                            <td className="text-right">
                              <NumInput width="w-16" value={r.min} min={0} max={100} step={draft.step} onChange={(v) => setRange(e, { min: v ?? 0 })} />
                            </td>
                            <td className="text-right">
                              <NumInput width="w-16" value={r.max} min={0} max={100} step={draft.step} onChange={(v) => setRange(e, { max: v ?? 0 })} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <label className="mt-2 flex items-center justify-between">
                    <span className="text-text-muted">조성 간격</span>
                    <select className="field num" value={draft.step} onChange={(e) => setDraft({ step: Number(e.target.value) })}>
                      {[2.5, 5, 10].map((s) => (
                        <option key={s} value={s}>
                          {s} at%
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="mt-1 text-text-muted">최소값 0은 해당 원소가 빠진 조성도 허용합니다.</p>
                </div>
              )}
              <div>
                <div className="mb-1 font-medium">고용체 판별 규칙</div>
                <ul className="space-y-1">
                  {PHASE_RULES.map((r) => (
                    <li key={r.key} className="flex justify-between gap-2">
                      <span className="num">{r.criterion}</span>
                      <span className="text-right text-text-muted">{r.source.split(",")[0]}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="text-text-muted">
                {DATA_SOURCES.map((s) => (
                  <div key={s.item}>
                    {s.item}: {s.source}
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
