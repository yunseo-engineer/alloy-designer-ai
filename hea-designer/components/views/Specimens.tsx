"use client";

import { useMemo, useState } from "react";
import { useResearchStore, type Specimen, type SpecimenStatus } from "@/store/useResearchStore";
import { useTargetsFor } from "@/lib/hooks";
import { evaluate } from "@/lib/designSpace";
import { DSMIX_FORMULA, PHASE_RULES, RHO_FORMULA, toWeightPercent, type Composition } from "@/lib/descriptors";
import { ELEMENT_PROPS } from "@/lib/elementData";
import { MODEL_CARD } from "@/lib/model";
import { nearestLiterature } from "@/lib/literature";
import { assessRisks, suggestProcess } from "@/lib/assessment";
import {
  Btn, EmptyState, Formula, NumInput, PageHeader, Panel, PassMark, Segmented, Tag, fmtTime, downloadText, toCsv,
} from "@/components/ui/primitives";

const STATUSES: SpecimenStatus[] = ["계획", "용해 완료", "시험 완료"];

function parseFormula(text: string): Composition | string {
  const re = /([A-Z][a-z]?)\s*(\d+(?:\.\d+)?)/g;
  const out: Composition = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!ELEMENT_PROPS[m[1]]) return `${m[1]}: 알 수 없는 원소 기호입니다.`;
    out[m[1]] = (out[m[1]] ?? 0) + Number(m[2]);
  }
  const keys = Object.keys(out);
  if (keys.length < 2) return "예: Ti30Zr20Hf15Nb25Ta10 형식으로 입력하세요.";
  const sum = keys.reduce((s, k) => s + out[k], 0);
  if (Math.abs(sum - 100) > 0.5) return `at% 합이 ${sum.toFixed(1)} 입니다. 100이 되도록 입력하세요.`;
  return out;
}

export function Specimens() {
  const specimens = useResearchStore((s) => s.specimens);
  const activeId = useResearchStore((s) => s.activeSpecimenId);
  const setActive = useResearchStore((s) => s.setActiveSpecimen);
  const setView = useResearchStore((s) => s.setView);
  const addSpecimen = useResearchStore((s) => s.addSpecimen);
  const draftTargets = useResearchStore((s) => s.draft.targets);
  const runs = useResearchStore((s) => s.runs);
  const [manual, setManual] = useState("");
  const [manualErr, setManualErr] = useState<string | null>(null);
  const activeRunId = useResearchStore((s) => s.activeRunId);
  const [scope, setScope] = useState<"run" | "all">(() =>
    activeRunId && specimens.some((sp) => sp.runId === activeRunId) ? "run" : "all"
  );
  const runCount = activeRunId ? specimens.filter((sp) => sp.runId === activeRunId).length : 0;
  const scoped = useMemo(
    () => (scope === "run" && activeRunId ? specimens.filter((sp) => sp.runId === activeRunId) : specimens),
    [scope, activeRunId, specimens]
  );

  const active = scoped.find((s) => s.id === activeId) ?? scoped[0] ?? null;

  const rows = useMemo(
    () =>
      scoped.map((sp) => {
        const t = runs.find((r) => r.id === sp.runId)?.spec.targets ?? draftTargets;
        return { sp, ev: evaluate(sp.composition, t) };
      }),
    [scoped, runs, draftTargets]
  );

  const exportCsv = () => {
    downloadText(
      "specimens.csv",
      toCsv([
        ["ID", "조성", "Run", "출처", "상태", "YS_pred", "YS_CI", "EL_pred", "EL_CI", "VEC", "delta", "Omega", "rho", "d_min"],
        ...rows.map(({ sp, ev }) => [
          sp.id, Object.entries(sp.composition).map(([k, v]) => `${k}${v}`).join(""), sp.runId ?? "", sp.origin, sp.status,
          ev.pred.ys, ev.pred.ysCi, ev.pred.el, ev.pred.elCi, ev.d.vec.toFixed(2), ev.d.delta.toFixed(2),
          ev.d.omega.toFixed(2), ev.d.rho.toFixed(2), ev.pred.dMin.toFixed(2),
        ]),
      ]),
      "text/csv"
    );
  };

  const submitManual = () => {
    const r = parseFormula(manual);
    if (typeof r === "string") return setManualErr(r);
    setManualErr(null);
    setManual("");
    addSpecimen(r, "직접 입력", activeRunId);
  };

  const [mode, setMode] = useState<"detail" | "table">("detail");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        index="4"
        title="시편 후보"
        desc="등록한 조성을 검토하고 미세 조정합니다. 조성을 바꾸면 descriptor와 예측이 즉시 다시 계산됩니다."
        right={
          <>
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitManual()}
              placeholder="조성 직접 입력  예: Ti30Zr20Hf15Nb25Ta10"
              className="field num h-8 w-72 text-xs"
            />
            <Btn onClick={submitManual}>추가</Btn>
          </>
        }
      />
      {manualErr && <p className="-mt-4 mb-4 text-right text-xs text-danger">{manualErr}</p>}

      {specimens.length === 0 ? (
        <EmptyState
          title="등록된 시편 후보가 없습니다"
          desc="탐색 공간에서 조성을 골라 등록하거나, 위 입력칸에 조성을 직접 입력하세요."
          action={<Btn variant="primary" onClick={() => setView("explore")}>탐색 공간으로</Btn>}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
            {activeRunId && (
              <Segmented<"run" | "all">
                value={scope}
                onChange={setScope}
                options={[
                  { value: "run", label: `${activeRunId} 시편 (${runCount})` },
                  { value: "all", label: `전체 시편 (${specimens.length})` },
                ]}
              />
            )}
            <Segmented<"detail" | "table">
              value={mode}
              onChange={setMode}
              options={[
                { value: "detail", label: "시편별 상세" },
                { value: "table", label: `비교표 (${scoped.length})` },
              ]}
            />
            </div>
            <Btn variant="ghost" onClick={exportCsv}>CSV 내보내기</Btn>
          </div>

          {scoped.length === 0 ? (
            <EmptyState
              title={`${activeRunId}에서 등록한 시편이 없습니다`}
              desc="탐색 공간에서 조성을 등록하거나, 전체 시편을 확인하세요."
              action={<Btn onClick={() => setScope("all")}>전체 시편 보기</Btn>}
            />
          ) : mode === "table" ? (
            <Panel bodyClass="pt-1">
              <div className="overflow-x-auto">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>조성 (at%)</th>
                      <th className="text-right">YS (MPa)</th>
                      <th className="text-right">EL (%)</th>
                      <th className="text-right">VEC</th>
                      <th className="text-right">δ (%)</th>
                      <th className="text-right">Ω</th>
                      <th className="text-right">ρ</th>
                      <th className="text-right">d_min</th>
                      <th>상태</th>
                      <th className="text-right">실측 YS / EL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ sp, ev }) => (
                      <tr
                        key={sp.id}
                        onClick={() => {
                          setActive(sp.id);
                          setMode("detail");
                        }}
                        className="cursor-pointer"
                      >
                        <td className="num font-medium">{sp.id}</td>
                        <td><Formula c={sp.composition} /></td>
                        <td className="num text-right">{ev.pred.ys} <span className="text-text-muted">±{ev.pred.ysCi}</span></td>
                        <td className="num text-right">{ev.pred.el} <span className="text-text-muted">±{ev.pred.elCi}</span></td>
                        <td className="num text-right">{ev.d.vec.toFixed(2)}</td>
                        <td className="num text-right">{ev.d.delta.toFixed(2)}</td>
                        <td className="num text-right">{ev.d.omega > 100 ? "> 100" : ev.d.omega.toFixed(1)}</td>
                        <td className="num text-right">{ev.d.rho.toFixed(2)}</td>
                        <td className="num text-right" style={{ color: ev.pred.extrapolated ? "var(--color-warning)" : undefined }}>
                          {ev.pred.dMin.toFixed(2)}
                        </td>
                        <td><StatusTag s={sp.status} /></td>
                        <td className="num text-right">
                          {sp.measured?.ys != null ? `${sp.measured.ys} / ${sp.measured.el ?? "—"}` : <span className="text-text-muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : (
            <div className="space-y-8">
              <ul className="divide-y divide-border border-y border-border">
                {rows.map(({ sp, ev }) => {
                  const on = sp.id === active?.id;
                  return (
                    <li key={sp.id}>
                      <button
                        onClick={() => setActive(sp.id)}
                        className={`w-full border-l-2 px-3 py-2.5 text-left transition ${on ? "border-accent bg-surface-2" : "border-border hover:bg-surface-2"}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="num text-xs font-semibold">{sp.id}</span>
                          <StatusTag s={sp.status} />
                        </div>
                        <Formula c={sp.composition} className="mt-1 block text-sm" />
                        <div className="num mt-1 text-[0.6875rem] text-text-muted">
                          YS {ev.pred.ys} · EL {ev.pred.el}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {active && <SpecimenDetail key={active.id} sp={active} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatusTag({ s }: { s: SpecimenStatus }) {
  return <Tag tone={s === "시험 완료" ? "accent" : s === "용해 완료" ? "ink" : "muted"}>{s}</Tag>;
}

function SpecimenDetail({ sp }: { sp: Specimen }) {
  const updateSpecimen = useResearchStore((s) => s.updateSpecimen);
  const removeSpecimen = useResearchStore((s) => s.removeSpecimen);
  const setView = useResearchStore((s) => s.setView);
  const t = useTargetsFor(sp.runId);

  const c = sp.composition;
  const ev = useMemo(() => evaluate(c, t), [c, t]);
  const risks = assessRisks(c, ev.d, ev.pred, t);
  const proc = suggestProcess(ev.d, ev.pred);
  const sum = Object.values(c).reduce((s, v) => s + v, 0);
  const wt = toWeightPercent(c);

  const setAt = (el: string, v: number) => {
    const next = { ...c, [el]: Math.max(0, Math.round(v * 10) / 10) };
    updateSpecimen(sp.id, {
      composition: next,
      origin: sp.origin.includes("수동 조정") ? sp.origin : `${sp.origin} → 수동 조정`,
    });
  };
  const normalize = () => {
    const next = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round((v / sum) * 1000) / 10]));
    updateSpecimen(sp.id, { composition: next });
  };

  const descRows: { label: string; value: string; rule?: (typeof PHASE_RULES)[number]; pass?: boolean; formula?: string }[] = [
    { label: "VEC", value: ev.d.vec.toFixed(3), rule: PHASE_RULES[0], pass: ev.rules.vec },
    { label: "δ (%)", value: ev.d.delta.toFixed(3), rule: PHASE_RULES[1], pass: ev.rules.delta },
    { label: "Ω", value: ev.d.omega > 100 ? "> 100" : ev.d.omega.toFixed(2), rule: PHASE_RULES[2], pass: ev.rules.omega },
    { label: "ΔHmix (kJ/mol)", value: ev.d.dHmix.toFixed(2), rule: PHASE_RULES[3], pass: ev.rules.dHmix },
    { label: "ΔSmix (J/K·mol)", value: ev.d.dSmix.toFixed(2), formula: DSMIX_FORMULA },
    { label: "Tm (K)", value: ev.d.tm.toFixed(0), formula: "Tm = Σ cᵢTmᵢ (혼합 법칙)" },
    { label: "ρ (g/cm³)", value: ev.d.rho.toFixed(3), formula: RHO_FORMULA },
  ];

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 pb-2">
        <div>
          <div className="num text-xs text-text-muted">
            {sp.id} · 등록 {fmtTime(sp.createdAt)} · {sp.origin}
            {sp.runId ? ` · ${sp.runId}` : ""}
          </div>
          <Formula c={c} className="mt-1 block text-2xl font-medium" />
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span>
              YS <span className="num font-medium">{ev.pred.ys}</span> <span className="num text-text-muted">± {ev.pred.ysCi} MPa</span>
            </span>
            <span>
              EL <span className="num font-medium">{ev.pred.el}</span> <span className="num text-text-muted">± {ev.pred.elCi} %</span>
            </span>
            <span className="text-text-muted">
              ρ <span className="num">{ev.d.rho.toFixed(2)}</span> g/cm³
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="field h-8 text-xs"
            value={sp.status}
            onChange={(e) => updateSpecimen(sp.id, { status: e.target.value as SpecimenStatus })}
          >
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <Btn variant="danger" onClick={() => removeSpecimen(sp.id)}>삭제</Btn>
        </div>
      </div>

      <div className="space-y-8">
      <div className="min-w-0 space-y-5">
        <Panel title="조성 조정" desc="숫자를 입력하거나 − / + 로 0.5 at%씩 바꾸면 모든 값이 다시 계산됩니다.">
          <table className="dtable">
            <thead>
              <tr>
                <th>원소</th>
                <th className="text-right">at%</th>
                <th className="text-right">wt%</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(c).map(([el, v]) => (
                <tr key={el}>
                  <td className="font-semibold">{el}</td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <button
                        onClick={() => setAt(el, v - 0.5)}
                        className="h-7 w-7 rounded-md border border-border text-text-muted hover:text-text"
                        aria-label={`${el} 감소`}
                      >
                        −
                      </button>
                      <NumInput
                        value={v}
                        onChange={(n) => setAt(el, n ?? 0)}
                        className="h-7"
                      />
                      <button
                        onClick={() => setAt(el, v + 0.5)}
                        className="h-7 w-7 rounded-md border border-border text-text-muted hover:text-text"
                        aria-label={`${el} 증가`}
                      >
                        +
                      </button>
                    </span>
                  </td>
                  <td className="num text-right text-text-muted">{wt[el]?.toFixed(2) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="num" style={{ color: Math.abs(sum - 100) > 0.05 ? "var(--color-danger)" : "var(--color-text-muted)" }}>
              합계 {sum.toFixed(1)} at%
            </span>
            <Btn onClick={normalize} disabled={Math.abs(sum - 100) <= 0.05}>100 at%로 맞추기</Btn>
          </div>
        </Panel>

        <Panel title="예측 · 대리 모델">
          <table className="dtable">
            <thead>
              <tr>
                <th>물성</th>
                <th className="text-right">예측</th>
                <th className="text-right">95% CI</th>
                <th className="text-right">목표</th>
                <th>판정</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>항복강도 YS</td>
                <td className="num text-right font-medium">{ev.pred.ys} MPa</td>
                <td className="num text-right text-text-muted">± {ev.pred.ysCi}</td>
                <td className="num text-right">≥ {t.ys}</td>
                <td><PassMark pass={ev.pred.ys >= t.ys} /></td>
              </tr>
              <tr>
                <td>연신율 EL</td>
                <td className="num text-right font-medium">{ev.pred.el} %</td>
                <td className="num text-right text-text-muted">± {ev.pred.elCi}</td>
                <td className="num text-right">≥ {t.el}</td>
                <td><PassMark pass={ev.pred.el >= t.el} /></td>
              </tr>
            </tbody>
          </table>
          {ev.pred.extrapolated && (
            <p className="mt-2 text-[0.6875rem] text-danger">
              외삽 영역: 가장 가까운 학습 조성과의 거리 {ev.pred.dMin.toFixed(2)} (임계 {MODEL_CARD.extrapolationThreshold}). 실측 데이터 확보 우선 대상입니다.
            </p>
          )}
          <details className="mt-3 text-[0.6875rem]">
            <summary className="cursor-pointer text-text-muted">모델 카드 · 근거 데이터</summary>
            <table className="dtable mt-2">
              <tbody>
                <tr><td className="w-24 whitespace-nowrap text-text-muted">모델</td><td>{MODEL_CARD.name} {MODEL_CARD.version}</td></tr>
                <tr><td className="w-24 whitespace-nowrap text-text-muted">유형</td><td>{MODEL_CARD.type}</td></tr>
                <tr><td className="w-24 whitespace-nowrap text-text-muted">입력</td><td>{MODEL_CARD.inputs.join(", ")}</td></tr>
                <tr><td className="w-24 whitespace-nowrap text-text-muted">학습 데이터</td><td>문헌 조성 {MODEL_CARD.trainingSize}건 (데모용 가상 데이터)</td></tr>
                <tr><td className="w-24 whitespace-nowrap text-text-muted">검증 RMSE</td><td className="num">YS {MODEL_CARD.validation.ysRmse} MPa · EL {MODEL_CARD.validation.elRmse} %p ({MODEL_CARD.validation.note})</td></tr>
                <tr><td className="w-24 whitespace-nowrap text-text-muted">YS 식</td><td className="num">{MODEL_CARD.ysFormula}</td></tr>
                <tr><td className="w-24 whitespace-nowrap text-text-muted">EL 식</td><td className="num">{MODEL_CARD.elFormula}</td></tr>
                <tr><td className="w-24 whitespace-nowrap text-text-muted">불확실도</td><td className="num">{MODEL_CARD.ciFormula}</td></tr>
              </tbody>
            </table>
            <div className="mt-2 text-text-muted">최근접 학습 조성</div>
            <table className="dtable">
              <tbody>
                {nearestLiterature(c).map(({ entry, distance }) => (
                  <tr key={entry.id}>
                    <td className="num text-text-muted">{entry.id}</td>
                    <td><Formula c={entry.composition} /></td>
                    <td className="num text-right">d = {distance.toFixed(2)}</td>
                    <td className="num text-right">{entry.ys} MPa / {entry.el} %</td>
                    <td className="text-text-muted">{entry.phase}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Panel>

        <Panel title="메모">
          <textarea
            value={sp.memo}
            onChange={(e) => updateSpecimen(sp.id, { memo: e.target.value })}
            rows={3}
            placeholder="이 시편을 선정한 이유, 주의할 점 등"
            className="field w-full resize-y text-xs"
          />
        </Panel>
      </div>

      <div className="min-w-0 space-y-5">
        <Panel title="Descriptor · 고용체 판별">
          <table className="dtable">
            <thead>
              <tr>
                <th>지표</th>
                <th className="text-right">값</th>
                <th>기준</th>
                <th>판정</th>
                <th>계산식 · 출처</th>
              </tr>
            </thead>
            <tbody>
              {descRows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="num text-right">{r.value}</td>
                  <td className="num text-[0.6875rem]">{r.rule?.criterion ?? "—"}</td>
                  <td>{r.pass != null ? <PassMark pass={r.pass} /> : <span className="text-[0.6875rem] text-text-muted">—</span>}</td>
                  <td className="text-[0.6875rem] text-text-muted">
                    <div className="num">{r.rule?.formula ?? r.formula}</div>
                    {r.rule && <div>{r.rule.source}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title={`실험 전 점검 · ${risks.length}건`}>
          {risks.length === 0 ? (
            <p className="text-xs text-text-muted">규칙 기반 점검에서 걸리는 항목이 없습니다.</p>
          ) : (
            <table className="dtable">
              <thead>
                <tr>
                  <th>수준</th>
                  <th>항목</th>
                  <th>근거</th>
                  <th>조치</th>
                </tr>
              </thead>
              <tbody>
                {risks.map((r) => (
                  <tr key={r.title}>
                    <td>
                      <Tag tone={r.level === "높음" ? "danger" : r.level === "중간" ? "ink" : "muted"}>{r.level}</Tag>
                    </td>
                    <td className="text-xs">{r.title}</td>
                    <td className="text-[0.6875rem] text-text-muted">{r.basis}</td>
                    <td className="text-[0.6875rem]">{r.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="권장 공정 경로" right={<Btn onClick={() => setView("plan")}>실험 계획서로 →</Btn>}>
          <table className="dtable">
            <tbody>
              <tr><td className="w-24 text-text-muted">1 용해</td><td>{proc.melt}</td></tr>
              <tr><td className="w-24 whitespace-nowrap text-text-muted">2 균질화</td><td className="num">{proc.homogenize}</td></tr>
              <tr><td className="w-24 whitespace-nowrap text-text-muted">3 압연</td><td className="num">{proc.roll}</td></tr>
              <tr><td className="w-24 whitespace-nowrap text-text-muted">4 어닐링</td><td className="num">{proc.anneal}</td></tr>
              <tr><td className="w-24 whitespace-nowrap text-text-muted">5 냉각</td><td>{proc.quench}</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-[0.6875rem] text-text-muted">산정 근거: {proc.basis}</p>
        </Panel>
      </div>
      </div>
    </div>
  );
}
