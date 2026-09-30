"use client";

import { useMemo, useState } from "react";
import { useResearchStore, type Measurement, type Specimen } from "@/store/useResearchStore";
import { useThemeColors } from "@/lib/hooks";
import { evaluate } from "@/lib/designSpace";
import type { PhaseLabel } from "@/lib/literature";
import { PlotCanvas, type PlotPoint } from "@/components/ui/PlotCanvas";
import { Btn, EmptyState, Formula, NumInput, PageHeader, Panel, Stat, StatList, Tag, downloadText, toCsv } from "@/components/ui/primitives";

const PHASES: PhaseLabel[] = ["BCC", "BCC+B2", "BCC+Laves", "BCC+σ", "BCC+HCP", "FCC", "기타"];

const today = () => new Date().toISOString().slice(0, 10);

export function Results() {
  const specimens = useResearchStore((s) => s.specimens);
  const runs = useResearchStore((s) => s.runs);
  const draftTargets = useResearchStore((s) => s.draft.targets);
  const setView = useResearchStore((s) => s.setView);
  const theme = useResearchStore((s) => s.theme);
  const C = useThemeColors();

  const rows = useMemo(
    () =>
      specimens.map((sp) => {
        const t = runs.find((r) => r.id === sp.runId)?.spec.targets ?? draftTargets;
        return { sp, ev: evaluate(sp.composition, t), t };
      }),
    [specimens, runs, draftTargets]
  );
  const measured = rows.filter((r) => r.sp.measured && (r.sp.measured.ys != null || r.sp.measured.el != null));

  const parity = (key: "ys" | "el") => {
    const pts: PlotPoint[] = measured
      .filter((r) => r.sp.measured?.[key] != null)
      .map((r) => {
        const pred = key === "ys" ? r.ev.pred.ys : r.ev.pred.el;
        const ci = key === "ys" ? r.ev.pred.ysCi : r.ev.pred.elCi;
        const m = r.sp.measured![key]!;
        const inside = Math.abs(m - pred) <= ci;
        return {
          x: pred, y: m, ex: ci, color: inside ? C.accent : C.danger, r: 4, label: r.sp.id.slice(-2),
          tooltip: [r.sp.id, `예측 ${pred} ± ${ci}`, `실측 ${m}`, inside ? "CI 내" : "CI 밖"],
        };
      });
    const vals = pts.flatMap((p) => [p.x - (p.ex ?? 0), p.x + (p.ex ?? 0), p.y]);
    const lo = key === "ys" ? Math.floor((Math.min(...vals, 800) - 50) / 100) * 100 : 0;
    const hi = key === "ys" ? Math.ceil((Math.max(...vals, 1200) + 50) / 100) * 100 : Math.ceil((Math.max(...vals, 40) + 5) / 10) * 10;
    return { pts, domain: [lo, hi] as [number, number] };
  };

  if (specimens.length === 0) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader index="6" title="실측 결과" />
        <EmptyState
          title="시편이 없습니다"
          desc="시편 후보를 등록하고 실험을 진행한 뒤, 이곳에 상 분석과 인장 결과를 입력하세요."
          action={<Btn onClick={() => setView("specimens")}>시편 후보로</Btn>}
        />
      </div>
    );
  }

  const ysP = parity("ys");
  const elP = parity("el");
  const errs = measured
    .filter((r) => r.sp.measured?.ys != null)
    .map((r) => r.sp.measured!.ys! - r.ev.pred.ys);
  const mae = errs.length ? Math.round(errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length) : null;
  const phaseMatch = measured.filter((r) => r.sp.measured?.phase).length;
  const bccOk = measured.filter((r) => r.sp.measured?.phase === "BCC").length;

  const exportCsv = () =>
    downloadText(
      "measurements.csv",
      toCsv([
        ["ID", "조성", "측정일", "상", "YS_pred", "YS_meas", "EL_pred", "EL_meas", "HV", "비고"],
        ...measured.map(({ sp, ev }) => [
          sp.id, Object.entries(sp.composition).map(([k, v]) => `${k}${v}`).join(""), sp.measured!.date, sp.measured!.phase,
          ev.pred.ys, sp.measured!.ys, ev.pred.el, sp.measured!.el, sp.measured!.hv, sp.measured!.note,
        ]),
      ]),
      "text/csv"
    );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        index="6"
        title="실측 결과"
        desc="실험 결과를 입력하면 예측과 비교됩니다. 입력된 데이터는 다음 모델 업데이트의 학습 데이터 후보로 표시됩니다."
        right={<Btn onClick={exportCsv} disabled={!measured.length}>실측 데이터 CSV</Btn>}
      />

      <StatList className="mb-8">
        <Stat label="실측 입력" value={`${measured.length} / ${specimens.length}`} sub="시편 기준" />
        <Stat label="YS 평균 절대 오차" value={mae ?? "—"} unit={mae != null ? "MPa" : undefined} sub="예측 대비" />
        <Stat label="BCC 단상 확인" value={phaseMatch ? `${bccOk} / ${phaseMatch}` : "—"} sub="XRD 판정 기준" />
        <Stat label="모델 반영 대기" value={measured.length} sub="프로토타입: 표시만 됨" />
      </StatList>

      <Panel title="결과 입력" desc="값을 입력하고 저장하면 시편 상태가 시험 완료로 바뀝니다." className="mb-8" bodyClass="pt-2">
        <div className="overflow-x-auto">
          <table className="dtable">
            <thead>
              <tr>
                <th>ID</th>
                <th>조성</th>
                <th>측정일</th>
                <th>상 (XRD)</th>
                <th className="text-right">YS 예측</th>
                <th className="text-right">YS 실측 (MPa)</th>
                <th className="text-right">EL 예측</th>
                <th className="text-right">EL 실측 (%)</th>
                <th className="text-right">경도 (HV)</th>
                <th>비고</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ sp, ev }) => (
                <ResultRow key={sp.id} sp={sp} ysPred={`${ev.pred.ys} ± ${ev.pred.ysCi}`} elPred={`${ev.pred.el} ± ${ev.pred.elCi}`} />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {measured.length > 0 ? (
        <div className="space-y-8">
          <PlotCanvas
            title="YS 예측 – 실측 (가로 막대: 95% CI)"
            xLabel="예측 YS (MPa)"
            yLabel="실측 YS (MPa)"
            xDomain={ysP.domain}
            yDomain={ysP.domain}
            layers={[{ points: ysP.pts, interactive: true }]}
            diagonal
            fileName="parity_ys"
            themeKey={theme}
            height={300}
            legend={[{ color: C.accent, label: "CI 내" }, { color: C.danger, label: "CI 밖" }]}
          />
          <PlotCanvas
            title="EL 예측 – 실측 (가로 막대: 95% CI)"
            xLabel="예측 EL (%)"
            yLabel="실측 EL (%)"
            xDomain={elP.domain}
            yDomain={elP.domain}
            layers={[{ points: elP.pts, interactive: true }]}
            diagonal
            fileName="parity_el"
            themeKey={theme}
            height={300}
            legend={[{ color: C.accent, label: "CI 내" }, { color: C.danger, label: "CI 밖" }]}
          />
        </div>
      ) : (
        <p className="text-xs text-text-muted">실측값을 입력하면 예측–실측 비교 그래프가 표시됩니다.</p>
      )}
    </div>
  );
}

function ResultRow({ sp, ysPred, elPred }: { sp: Specimen; ysPred: string; elPred: string }) {
  const saveMeasurement = useResearchStore((s) => s.saveMeasurement);
  const [m, setM] = useState<Measurement>(
    sp.measured ?? { phase: "", ys: null, el: null, hv: null, date: today(), note: "" }
  );
  const dirty = JSON.stringify(m) !== JSON.stringify(sp.measured ?? { phase: "", ys: null, el: null, hv: null, date: m.date, note: "" });

  return (
    <tr>
      <td className="num font-medium">{sp.id}</td>
      <td><Formula c={sp.composition} /></td>
      <td>
        <input type="date" value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} className="field num text-[0.6875rem]" />
      </td>
      <td>
        <select value={m.phase} onChange={(e) => setM({ ...m, phase: e.target.value as PhaseLabel })} className="field text-[0.6875rem]">
          <option value="">—</option>
          {PHASES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </td>
      <td className="num text-right text-text-muted">{ysPred}</td>
      <td className="text-right"><NumInput value={m.ys} allowEmpty step={5} width="w-20" onChange={(v) => setM({ ...m, ys: v })} /></td>
      <td className="num text-right text-text-muted">{elPred}</td>
      <td className="text-right"><NumInput value={m.el} allowEmpty step={0.5} onChange={(v) => setM({ ...m, el: v })} /></td>
      <td className="text-right"><NumInput value={m.hv} allowEmpty step={5} onChange={(v) => setM({ ...m, hv: v })} /></td>
      <td>
        <input value={m.note} onChange={(e) => setM({ ...m, note: e.target.value })} className="field w-40 text-[0.6875rem]" placeholder="시험 조건 등" />
      </td>
      <td className="text-right">
        {dirty ? (
          <Btn variant="primary" onClick={() => saveMeasurement(sp.id, m)}>저장</Btn>
        ) : sp.measured ? (
          <Tag tone="success">저장됨</Tag>
        ) : null}
      </td>
    </tr>
  );
}
