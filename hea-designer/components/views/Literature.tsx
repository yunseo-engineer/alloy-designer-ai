"use client";

import { Fragment, useMemo, useState } from "react";
import { LITERATURE, formula, type PhaseLabel } from "@/lib/literature";
import { computeDescriptors } from "@/lib/descriptors";
import { Btn, Formula, PageHeader, Panel, Tag, downloadText, toCsv } from "@/components/ui/primitives";

type SortKey = "year" | "ys" | "el";

export function Literature() {
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState<"" | PhaseLabel>("");
  const [sort, setSort] = useState<SortKey>("year");
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return LITERATURE.filter((l) => {
      if (phase && l.phase !== phase) return false;
      if (!query) return true;
      const hay = `${formula(l.composition)} ${l.title} ${l.authors} ${l.journal} ${l.condition}`.toLowerCase();
      // element query like "Mo" or "Ti Nb" — every token must match
      return query.split(/\s+/).every((tok) => hay.includes(tok));
    }).sort((a, b) => (sort === "year" ? b.year - a.year : sort === "ys" ? b.ys - a.ys : b.el - a.el));
  }, [q, phase, sort]);

  const exportCsv = () =>
    downloadText(
      "literature.csv",
      toCsv([
        ["ID", "조성", "상", "YS", "EL", "조건", "시험온도", "저자", "연도", "저널", "DOI", "신뢰도"],
        ...rows.map((l) => [l.id, formula(l.composition), l.phase, l.ys, l.el, l.condition, l.testTemp, l.authors, l.year, l.journal, l.doi ?? "", l.confidence]),
      ]),
      "text/csv"
    );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="문헌 데이터"
        desc="예측 모델의 학습·비교 기준이 되는 문헌 보고값입니다. 탐색 공간 그래프에 겹쳐 볼 수 있습니다."
        right={<Btn onClick={exportCsv}>CSV</Btn>}
      />
      <div className="mb-4 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-muted">
        현재 목록은 프로토타입 시연용 가상 데이터입니다. 실제 사용 전 검증된 문헌(DOI 포함)으로 교체해야 합니다.
      </div>

      <Panel
        title={`${rows.length}건`}
        right={
          <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="원소·저자·저널 검색 (예: Mo Ti)"
              className="field w-56 text-[0.6875rem]"
            />
            <select className="field text-[0.6875rem]" value={phase} onChange={(e) => setPhase(e.target.value as PhaseLabel | "")}>
              <option value="">상 전체</option>
              {["BCC", "BCC+B2", "BCC+Laves", "BCC+σ", "FCC"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <select className="field text-[0.6875rem]" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="year">최신순</option>
              <option value="ys">YS 높은 순</option>
              <option value="el">EL 높은 순</option>
            </select>
          </>
        }
      >
        <table className="dtable">
          <thead>
            <tr>
              <th>ID</th>
              <th>조성 (at%)</th>
              <th>상</th>
              <th className="text-right">YS (MPa)</th>
              <th className="text-right">EL (%)</th>
              <th className="text-right">VEC</th>
              <th className="text-right">δ (%)</th>
              <th>가공 조건</th>
              <th>출처</th>
              <th>신뢰도</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const d = computeDescriptors(l.composition);
              const isOpen = open === l.id;
              return (
                <Fragment key={l.id}>
                  <tr onClick={() => setOpen(isOpen ? null : l.id)} className="cursor-pointer">
                    <td className="num text-text-muted">{l.id}</td>
                    <td><Formula c={l.composition} /></td>
                    <td><Tag tone={l.phase === "BCC" ? "ink" : "danger"}>{l.phase}</Tag></td>
                    <td className="num text-right">{l.ys}</td>
                    <td className="num text-right">{l.el}</td>
                    <td className="num text-right">{d.vec.toFixed(2)}</td>
                    <td className="num text-right">{d.delta.toFixed(2)}</td>
                    <td className="text-[0.6875rem]">{l.condition}</td>
                    <td className="text-[0.6875rem] text-text-muted">
                      {l.authors} ({l.year}) · <i>{l.journal}</i>
                    </td>
                    <td>
                      <Tag tone={l.confidence === "HIGH" ? "ink" : "muted"}>{l.confidence}</Tag>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td />
                      <td colSpan={9} className="bg-surface-2 text-[0.6875rem]">
                        <div className="font-medium">{l.title}</div>
                        <div className="mt-1 text-text-muted">{l.excerpt}</div>
                        <div className="mt-1 text-text-muted">
                          DOI: {l.doi ?? "미등록"} · 시험 온도 {l.testTemp}°C
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
