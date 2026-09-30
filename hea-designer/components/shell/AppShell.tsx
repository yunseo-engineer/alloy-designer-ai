"use client";

import { useRef, useState } from "react";

import { useResearchStore, type View } from "@/store/useResearchStore";
import { Btn, downloadText, fmtTime } from "@/components/ui/primitives";
import { DesignSetup } from "@/components/views/DesignSetup";
import { RunLog } from "@/components/views/RunLog";
import { Explore } from "@/components/views/Explore";
import { Specimens } from "@/components/views/Specimens";
import { ExperimentPlan } from "@/components/views/ExperimentPlan";
import { Results } from "@/components/views/Results";
import { Literature } from "@/components/views/Literature";
import { Notebook } from "@/components/views/Notebook";

const STEPS: { id: View; label: string; hint: string }[] = [
  { id: "setup", label: "설계 조건", hint: "원소 · 목표" },
  { id: "run", label: "계산", hint: "로그" },
  { id: "explore", label: "탐색 공간", hint: "조성 선택" },
  { id: "specimens", label: "시편 후보", hint: "검토 · 조정" },
  { id: "plan", label: "실험 계획서", hint: "칭량 · 공정" },
  { id: "results", label: "실측 결과", hint: "예측 검증" },
];

const RECORDS: { id: View; label: string }[] = [
  { id: "literature", label: "문헌 데이터" },
  { id: "notebook", label: "연구 노트" },
];

const VIEWS: Record<View, () => React.ReactElement> = {
  setup: DesignSetup,
  run: RunLog,
  explore: Explore,
  specimens: Specimens,
  plan: ExperimentPlan,
  results: Results,
  literature: Literature,
  notebook: Notebook,
};

export function AppShell() {
  const view = useResearchStore((s) => s.view);
  const setView = useResearchStore((s) => s.setView);
  const projectName = useResearchStore((s) => s.projectName);
  const setProjectName = useResearchStore((s) => s.setProjectName);
  const theme = useResearchStore((s) => s.theme);
  const setTheme = useResearchStore((s) => s.setTheme);
  const fontScale = useResearchStore((s) => s.fontScale ?? 100);
  const setFontScale = useResearchStore((s) => s.setFontScale);
  const runs = useResearchStore((s) => s.runs);
  const activeRunId = useResearchStore((s) => s.activeRunId);
  const setActiveRun = useResearchStore((s) => s.setActiveRun);
  const specimens = useResearchStore((s) => s.specimens);
  const notes = useResearchStore((s) => s.notes);
  const newDesign = useResearchStore((s) => s.newDesign);
  const resetSession = useResearchStore((s) => s.resetSession);
  const importSession = useResearchStore((s) => s.importSession);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sessionMsg, setSessionMsg] = useState<string | null>(null);

  // Progress reflects the Run currently being viewed, not the whole session history.
  const activeRun = runs.find((r) => r.id === activeRunId) ?? null;
  const runSpecimens = activeRun ? specimens.filter((s) => s.runId === activeRun.id) : [];
  const runMeasured = runSpecimens.filter((s) => s.measured).length;
  const done: Record<string, boolean> = {
    setup: !!activeRun,
    run: !!activeRun,
    explore: runSpecimens.length > 0,
    specimens: runSpecimens.some((s) => s.status !== "계획") || runMeasured > 0,
    plan: runSpecimens.some((s) => s.status !== "계획"),
    results: runMeasured > 0,
  };
  const badge: Partial<Record<View, number>> = {
    specimens: runSpecimens.length,
    results: runMeasured,
    notebook: notes.length,
  };

  const importFile = async (f: File) => {
    try {
      const err = importSession(JSON.parse(await f.text()));
      setSessionMsg(err ?? "세션을 불러왔습니다.");
    } catch {
      setSessionMsg("JSON 파일을 읽을 수 없습니다.");
    }
    setTimeout(() => setSessionMsg(null), 4000);
  };

  const confirmReset = () => {
    if (window.confirm("모든 Run, 시편, 실측 결과, 연구 노트를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?")) {
      resetSession();
      setSessionMsg("세션을 초기화했습니다.");
      setTimeout(() => setSessionMsg(null), 4000);
    }
  };

  const next: Partial<Record<View, { label: string; to: View; show: boolean }>> = {
    explore: { label: `시편 후보 검토 (${specimens.length})`, to: "specimens", show: specimens.length > 0 },
    specimens: { label: "실험 계획서 만들기", to: "plan", show: specimens.length > 0 },
    plan: { label: "실측 결과 입력", to: "results", show: specimens.length > 0 },
  };
  const nx = next[view];

  const exportSession = () => {
    const state = useResearchStore.getState();
    const data = {
      exportedAt: new Date().toISOString(),
      app: "hea-designer-v2",
      projectName: state.projectName,
      runs: state.runs,
      specimens: state.specimens,
      notes: state.notes,
    };
    downloadText(`${state.projectName.replace(/\s+/g, "_")}_session.json`, JSON.stringify(data, null, 2), "application/json");
  };

  const Active = VIEWS[view];

  return (
    <div className="flex h-screen flex-col">
      <header className="no-print flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-xs font-bold text-white">H</span>
          <span className="text-sm font-semibold">HEA Designer</span>
          <span className="text-text-muted">/</span>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="min-w-0 max-w-80 flex-1 rounded-md bg-transparent px-1.5 py-1 text-sm outline-none hover:bg-surface-2 focus:bg-surface-2"
            title="프로젝트 이름 (클릭해서 수정)"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Btn onClick={newDesign} title="설계 조건을 비우고 1단계부터 시작합니다. 이전 Run과 시편은 이력에 남습니다.">
            + 새 설계
          </Btn>
          {runs.length > 0 && (
            <select
              value={activeRunId ?? ""}
              onChange={(e) => setActiveRun(e.target.value || null)}
              className="field num h-8 text-xs"
              title="보고 있는 계산 Run"
            >
              <option value="">새 설계 작성 중</option>
              {[...runs].reverse().map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} · {r.spec.elements.join("")} · {fmtTime(r.createdAt).slice(5)}
                </option>
              ))}
            </select>
          )}
          <span
            className="rounded-full border border-border px-2.5 py-1 text-[0.6875rem] text-text-muted"
            title="예측 모델과 문헌 데이터는 시연용입니다"
          >
            데모 모델 · 가상 문헌
          </span>
          <div className="flex h-8 items-center rounded-lg border border-border text-xs" title="글자 크기">
            <button
              onClick={() => setFontScale(fontScale - 10)}
              disabled={fontScale <= 80}
              className="h-full px-2 text-text-muted hover:text-text disabled:opacity-30"
              aria-label="글자 작게"
            >
              가−
            </button>
            <button
              onClick={() => setFontScale(100)}
              className="num h-full border-x border-border px-2 text-text-muted hover:text-text"
              title="기본 크기로"
            >
              {fontScale}%
            </button>
            <button
              onClick={() => setFontScale(fontScale + 10)}
              disabled={fontScale >= 140}
              className="h-full px-2 text-text-muted hover:text-text disabled:opacity-30"
              aria-label="글자 크게"
            >
              가+
            </button>
          </div>
          <button
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-sm text-text-muted hover:text-text"
            title={theme === "light" ? "다크 모드" : "라이트 모드"}
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="no-print flex w-60 shrink-0 flex-col justify-between border-r border-border bg-surface px-3 py-5">
          <nav>
            <div className="flex items-baseline justify-between px-3 pb-2 text-[0.6875rem] font-medium text-text-muted">
              <span>연구 단계</span>
              <span className="num">{activeRun ? activeRun.id : "새 설계"}</span>
            </div>
            <ol className="relative">
              {STEPS.map((s, i) => {
                const active = view === s.id;
                const ok = done[s.id];
                return (
                  <li key={s.id} className="relative">
                    {i < STEPS.length - 1 && (
                      <span
                        className="absolute left-[23px] top-9 h-[calc(100%-24px)] w-px"
                        style={{ background: ok ? "var(--color-text)" : "var(--color-border)" }}
                      />
                    )}
                    <button
                      onClick={() => setView(s.id)}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
                        active ? "bg-accent-soft" : "hover:bg-surface-2"
                      }`}
                    >
                      <span
                        className="num relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-medium"
                        style={
                          active
                            ? { background: "var(--color-accent)", borderColor: "var(--color-accent)", color: "white" }
                            : ok
                            ? { background: "var(--color-text)", borderColor: "var(--color-text)", color: "var(--color-surface)" }
                            : { background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text-muted)" }
                        }
                      >
                        {ok && !active ? "✓" : i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${active ? "font-semibold text-accent" : ""}`}>{s.label}</span>
                        <span className="block text-[0.6875rem] text-text-muted">{s.hint}</span>
                      </span>
                      {badge[s.id] ? <span className="num text-xs text-text-muted">{badge[s.id]}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="mt-6 px-3 pb-2 text-[0.6875rem] font-medium text-text-muted">기록</div>
            {RECORDS.map((r) => (
              <button
                key={r.id}
                onClick={() => setView(r.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                  view === r.id ? "bg-accent-soft font-semibold text-accent" : "hover:bg-surface-2"
                }`}
              >
                {r.label}
                {badge[r.id] ? <span className="num text-xs font-normal text-text-muted">{badge[r.id]}</span> : null}
              </button>
            ))}
          </nav>

          <div className="space-y-5 px-3">
          <div>
            <div className="pb-2 text-[0.6875rem] font-medium text-text-muted">세션</div>
            <div className="flex flex-col items-start gap-1 text-xs">
              <button onClick={exportSession} className="text-text-muted hover:text-text">
                저장 (JSON 내보내기)
              </button>
              <button onClick={() => fileRef.current?.click()} className="text-text-muted hover:text-text">
                불러오기
              </button>
              <button onClick={confirmReset} className="text-text-muted hover:text-danger">
                초기화
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importFile(f);
                  e.target.value = "";
                }}
              />
              {sessionMsg && <span className="text-[0.6875rem] text-accent">{sessionMsg}</span>}
            </div>
          </div>
          <div>
            <div className="pb-2 text-[0.6875rem] font-medium text-text-muted">Run 이력</div>
            {runs.length === 0 && <div className="text-xs text-text-muted">아직 실행 없음</div>}
            <ul className="max-h-36 space-y-0.5 overflow-y-auto">
              {[...runs].reverse().map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => {
                      setActiveRun(r.id);
                      setView("explore");
                    }}
                    className={`num flex w-full justify-between rounded px-1 py-0.5 text-xs ${
                      r.id === activeRunId ? "text-accent" : "text-text-muted hover:text-text"
                    }`}
                  >
                    <span>{r.id}</span>
                    <span className="truncate pl-2">{r.spec.elements.join("")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-8 py-7">
          <Active key={view} />
          {nx?.show && (
            <div className="no-print mx-auto mt-8 flex max-w-5xl justify-end border-t border-border pt-5">
              <Btn variant="primary" size="md" onClick={() => setView(nx.to)}>
                다음: {nx.label} →
              </Btn>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
