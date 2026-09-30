"use client";

import { useState } from "react";
import { EMPTY_LOG, useResearchStore, type Specimen } from "@/store/useResearchStore";
import { evaluate } from "@/lib/designSpace";
import { toWeightPercent } from "@/lib/descriptors";
import { ELEMENT_PROPS } from "@/lib/elementData";
import { suggestProcess, assessRisks } from "@/lib/assessment";
import { Btn, EmptyState, Formula, NumInput, PageHeader, downloadText, toCsv, fmtTime } from "@/components/ui/primitives";

const CHARACTERIZATION = [
  { name: "XRD", cond: "Cu Kα, 2θ 20–100°", purpose: "BCC 단상 여부 · 격자상수" },
  { name: "SEM-BSE / EDS", cond: "균질화 후 · 압연재", purpose: "2차상 · 조성 편차 확인" },
  { name: "EBSD", cond: "어닐링재", purpose: "결정립 크기 · 재결정 분율" },
  { name: "경도", cond: "HV0.5, 10점", purpose: "강도 산포 사전 확인" },
  { name: "상온 인장", cond: "변형률 속도 1×10⁻³ s⁻¹, n ≥ 3", purpose: "YS · EL 실측" },
];

const log = (sp: Specimen) => sp.log ?? EMPTY_LOG;

function TextCell({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="field w-full text-xs"
    />
  );
}

/** Weighing table: typed actual masses, deviation from target, and composition recomputed from what was weighed. */
function WeighingSection({ sp, mass, wt }: { sp: Specimen; mass: number; wt: Record<string, number> }) {
  const updateLog = useResearchStore((s) => s.updateLog);
  const l = log(sp);
  const els = Object.keys(sp.composition);
  const actual = els.map((el) => ({ el, g: parseFloat(l.weighed[el] ?? "") }));
  const allWeighed = actual.every((a) => !Number.isNaN(a.g) && a.g > 0);
  let actualAt: Record<string, number> | null = null;
  if (allWeighed) {
    const mol = actual.map((a) => ({ el: a.el, n: a.g / ELEMENT_PROPS[a.el].A }));
    const tot = mol.reduce((s, m) => s + m.n, 0);
    actualAt = Object.fromEntries(mol.map((m) => [m.el, (m.n / tot) * 100]));
  }
  return (
    <section className="mb-4">
      <h4 className="mb-1 text-xs font-medium">1. 칭량표 · 배치 {mass} g · 원료 순도 ≥ 99.9 wt%</h4>
      <table className="dtable">
        <thead>
          <tr>
            <th>원소</th>
            <th className="text-right">at%</th>
            <th className="text-right">wt%</th>
            <th className="text-right">목표 질량 (g)</th>
            <th className="w-32 text-right">실측 칭량 (g)</th>
            <th className="text-right">편차</th>
            <th className="w-40">원료 Lot</th>
          </tr>
        </thead>
        <tbody>
          {els.map((el) => {
            const target = (wt[el] / 100) * mass;
            const g = parseFloat(l.weighed[el] ?? "");
            const dev = Number.isNaN(g) ? null : ((g - target) / target) * 100;
            return (
              <tr key={el}>
                <td>
                  {el} <span className="text-[0.625rem] text-text-muted">({ELEMENT_PROPS[el].A} g/mol)</span>
                </td>
                <td className="num text-right">{sp.composition[el].toFixed(1)}</td>
                <td className="num text-right">{wt[el].toFixed(2)}</td>
                <td className="num text-right font-medium">{target.toFixed(4)}</td>
                <td className="text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={l.weighed[el] ?? ""}
                    placeholder="0.0000"
                    onChange={(e) => {
                      const v = e.target.value.replace(",", ".");
                      if (!/^\d*\.?\d*$/.test(v)) return;
                      updateLog(sp.id, (x) => ({ ...x, weighed: { ...x.weighed, [el]: v } }));
                    }}
                    className="field num w-full text-right text-xs"
                  />
                </td>
                <td
                  className="num text-right text-xs"
                  style={{ color: dev != null && Math.abs(dev) > 0.5 ? "var(--color-danger)" : "var(--color-text-muted)" }}
                >
                  {dev == null ? "—" : Math.abs(dev) < 0.005 ? "0.00 %" : `${dev > 0 ? "+" : ""}${dev.toFixed(2)} %`}
                </td>
                <td>
                  <TextCell
                    value={l.lots[el] ?? ""}
                    placeholder="Lot 번호"
                    onChange={(v) => updateLog(sp.id, (x) => ({ ...x, lots: { ...x.lots, [el]: v } }))}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[0.6875rem] text-text-muted">
        {actualAt ? (
          <>
            칭량 기준 실제 조성:{" "}
            <span className="num text-text">
              {els.map((el) => `${el}${actualAt![el].toFixed(2)}`).join(" ")}
            </span>{" "}
            (at%) · 편차가 ±0.5 %를 넘으면 빨간색으로 표시됩니다.
          </>
        ) : (
          "모든 원소의 실측 칭량을 입력하면 실제 조성(at%)이 계산됩니다. 편차가 ±0.5 %를 넘으면 빨간색으로 표시됩니다."
        )}
      </p>
    </section>
  );
}

export function ExperimentPlan() {
  const updateLog = useResearchStore((s) => s.updateLog);
  const specimens = useResearchStore((s) => s.specimens);
  const runs = useResearchStore((s) => s.runs);
  const draftTargets = useResearchStore((s) => s.draft.targets);
  const projectName = useResearchStore((s) => s.projectName);
  const setView = useResearchStore((s) => s.setView);

  const [mass, setMass] = useState(30);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(specimens.filter((s) => s.status !== "시험 완료").map((s) => s.id))
  );

  if (specimens.length === 0) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader index="5" title="실험 계획서" />
        <EmptyState
          title="계획할 시편이 없습니다"
          desc="시편 후보를 먼저 등록하세요. 칭량표와 공정 조건이 자동으로 계산됩니다."
          action={<Btn onClick={() => setView("explore")}>탐색 공간으로</Btn>}
        />
      </div>
    );
  }

  const chosen = specimens.filter((s) => picked.has(s.id));

  const exportCsv = () => {
    const rows: (string | number)[][] = [["시편 ID", "원소", "at%", "wt%", `목표 질량 (g, ${mass} g 배치)`]];
    chosen.forEach((sp) => {
      const wt = toWeightPercent(sp.composition);
      Object.entries(sp.composition).forEach(([el, a]) => {
        rows.push([sp.id, el, a, wt[el].toFixed(3), ((wt[el] / 100) * mass).toFixed(4)]);
      });
    });
    downloadText("weighing_sheet.csv", toCsv(rows), "text/csv");
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        index="5"
        title="실험 계획서"
        desc="실측 칭량, 원료 Lot, 공정·분석 완료 여부를 화면에서 바로 입력하면 시편별로 저장됩니다. 인쇄하면 입력한 값이 채워진 계획서가 나옵니다."
        right={
          <>
            <span className="text-[0.6875rem] text-text-muted">배치 질량</span>
            <NumInput value={mass} step={5} onChange={(v) => setMass(v ?? 30)} />
            <span className="text-[0.6875rem] text-text-muted">g</span>
            <Btn onClick={exportCsv} disabled={!chosen.length}>칭량표 CSV</Btn>
            <Btn variant="primary" onClick={() => window.print()} disabled={!chosen.length}>
              인쇄 / PDF
            </Btn>
          </>
        }
      />

      <div className="no-print mb-6 flex flex-wrap gap-3 border-b border-border pb-3 text-xs">
        <span className="text-text-muted">포함할 시편:</span>
        {specimens.map((s) => (
          <label key={s.id} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={picked.has(s.id)}
              onChange={(e) =>
                setPicked((p) => {
                  const n = new Set(p);
                  if (e.target.checked) n.add(s.id);
                  else n.delete(s.id);
                  return n;
                })
              }
            />
            <span className="num">{s.id}</span>
            <span className="text-[0.625rem] text-text-muted">({s.status})</span>
          </label>
        ))}
      </div>

      <div className="space-y-14">
        {chosen.map((sp) => {
          const t = runs.find((r) => r.id === sp.runId)?.spec.targets ?? draftTargets;
          const ev = evaluate(sp.composition, t);
          const proc = suggestProcess(ev.d, ev.pred);
          const risks = assessRisks(sp.composition, ev.d, ev.pred, t).filter((r) => r.level !== "낮음");
          const wt = toWeightPercent(sp.composition);
          return (
            <article key={sp.id} className="print-page border-t-2 border-text pt-5">
              <header className="mb-3 flex items-start justify-between gap-4 border-b border-border pb-2">
                <div>
                  <div className="text-[0.6875rem] text-text-muted">{projectName} · 시편 제작 계획서</div>
                  <div className="mt-0.5 flex items-baseline gap-3">
                    <span className="num text-base font-semibold">{sp.id}</span>
                    <Formula c={sp.composition} className="text-sm" />
                  </div>
                </div>
                <table className="text-[0.6875rem]">
                  <tbody>
                    <tr><td className="pr-2 text-text-muted">작성</td><td className="num">{fmtTime(new Date().toISOString())}</td></tr>
                    <tr><td className="pr-2 text-text-muted">출처</td><td>{sp.origin}{sp.runId ? ` · ${sp.runId}` : ""}</td></tr>
                    <tr>
                      <td className="pr-2 text-text-muted">담당</td>
                      <td>
                        <TextCell
                          value={log(sp).operator}
                          placeholder="이름"
                          onChange={(v) => updateLog(sp.id, (l) => ({ ...l, operator: v }))}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </header>

              <WeighingSection sp={sp} mass={mass} wt={wt} />

              <section className="mb-4">
                <h4 className="mb-1 text-xs font-medium">2. 공정 조건</h4>
                <table className="dtable">
                  <thead>
                    <tr><th className="w-20">단계</th><th>계획 조건</th><th className="w-[34%]">실제 조건 / 비고</th><th className="w-14 text-center">완료</th></tr>
                  </thead>
                  <tbody>
                    {[
                      ["용해", proc.melt],
                      ["균질화", proc.homogenize],
                      ["압연", proc.roll],
                      ["어닐링", proc.anneal],
                      ["냉각", proc.quench],
                    ].map(([k, v]) => {
                      const st = log(sp).steps[k] ?? { done: false, actual: "" };
                      return (
                        <tr key={k}>
                          <td>{k}</td>
                          <td className="text-xs">{v}</td>
                          <td>
                            <TextCell
                              value={st.actual}
                              placeholder="계획과 다르게 진행한 점"
                              onChange={(val) =>
                                updateLog(sp.id, (l) => ({ ...l, steps: { ...l.steps, [k]: { ...st, actual: val } } }))
                              }
                            />
                          </td>
                          <td className="text-center">
                            <input
                              type="checkbox"
                              checked={st.done}
                              aria-label={`${k} 완료`}
                              onChange={(e) =>
                                updateLog(
                                  sp.id,
                                  (l) => ({ ...l, steps: { ...l.steps, [k]: { ...st, done: e.target.checked } } }),
                                  e.target.checked ? `공정 완료 · ${k}${st.actual ? ` (${st.actual})` : ""}` : undefined
                                )
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-1 text-[0.625rem] text-text-muted">산정 근거: {proc.basis}</p>
              </section>

              <section className="mb-4">
                <h4 className="mb-1 text-xs font-medium">3. 분석 · 시험 계획</h4>
                <table className="dtable">
                  <thead>
                    <tr><th className="w-28">항목</th><th>조건</th><th>목적</th><th className="w-36">일자</th><th className="w-14 text-center">완료</th></tr>
                  </thead>
                  <tbody>
                    {CHARACTERIZATION.map((c) => {
                      const ts = log(sp).tests[c.name] ?? { done: false, date: "" };
                      return (
                        <tr key={c.name}>
                          <td>{c.name}</td>
                          <td className="text-[0.6875rem]">{c.cond}</td>
                          <td className="text-[0.6875rem] text-text-muted">{c.purpose}</td>
                          <td>
                            <input
                              type="date"
                              value={ts.date}
                              onChange={(e) =>
                                updateLog(sp.id, (l) => ({ ...l, tests: { ...l.tests, [c.name]: { ...ts, date: e.target.value } } }))
                              }
                              className="field num w-full text-[0.6875rem]"
                            />
                          </td>
                          <td className="text-center">
                            <input
                              type="checkbox"
                              checked={ts.done}
                              aria-label={`${c.name} 완료`}
                              onChange={(e) =>
                                updateLog(
                                  sp.id,
                                  (l) => ({ ...l, tests: { ...l.tests, [c.name]: { ...ts, done: e.target.checked } } }),
                                  e.target.checked ? `분석 완료 · ${c.name}` : undefined
                                )
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>

              <section className="space-y-4">
                <div>
                  <h4 className="mb-1 text-xs font-medium">4. 예측값 (검증 대상)</h4>
                  <table className="dtable">
                    <tbody>
                      <tr><td>YS</td><td className="num text-right">{ev.pred.ys} ± {ev.pred.ysCi} MPa</td><td className="text-[0.6875rem] text-text-muted">목표 ≥ {t.ys}</td></tr>
                      <tr><td>EL</td><td className="num text-right">{ev.pred.el} ± {ev.pred.elCi} %</td><td className="text-[0.6875rem] text-text-muted">목표 ≥ {t.el}</td></tr>
                      <tr><td>예상 상</td><td className="num text-right">BCC 단상</td><td className="text-[0.6875rem] text-text-muted">VEC {ev.d.vec.toFixed(2)} · δ {ev.d.delta.toFixed(2)} %</td></tr>
                      <tr><td>이론 밀도</td><td className="num text-right">{ev.d.rho.toFixed(2)} g/cm³</td><td className="text-[0.6875rem] text-text-muted">아르키메데스법 비교</td></tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <h4 className="mb-1 text-xs font-medium">5. 주의 사항</h4>
                  {risks.length === 0 ? (
                    <p className="text-[0.6875rem] text-text-muted">해당 없음</p>
                  ) : (
                    <ul className="list-disc space-y-1 pl-4 text-[0.6875rem]">
                      {risks.map((r) => (
                        <li key={r.title}>
                          <span className="font-medium">{r.title}</span> — {r.action}
                        </li>
                      ))}
                    </ul>
                  )}
                  {sp.memo && <p className="mt-2 text-[0.6875rem]">메모: {sp.memo}</p>}
                </div>
              </section>
            </article>
          );
        })}
      </div>
    </div>
  );
}
