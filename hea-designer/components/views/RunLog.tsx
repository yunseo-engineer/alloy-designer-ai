"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useResearchStore, type Run } from "@/store/useResearchStore";
import { useActiveRun } from "@/lib/hooks";
import { PHASE_RULES } from "@/lib/descriptors";
import { MODEL_CARD } from "@/lib/model";
import type { DSResult } from "@/lib/designSpace";
import { SynthesisCanvas } from "@/components/run/SynthesisCanvas";
import { Btn, EmptyState, PageHeader, Panel } from "@/components/ui/primitives";

type Line = { t: string; text: string; tone?: "muted" | "ok" | "warn"; phase: number };

function stamp(base: Date, offsetMs: number) {
  const d = new Date(base.getTime() + offsetMs);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function buildLines(run: Run, ds: DSResult): Line[] {
  const s = ds.stats;
  const base = new Date(run.createdAt);
  const t = run.spec.targets;
  const at = (f: number) => stamp(base, Math.round(s.ms * f));
  const L: Line[] = [];
  L.push({ phase: 0, t: at(0), text: `${run.id} 시작 · ${run.spec.elements.join("-")} · ${run.spec.step} at% 간격` });
  L.push({
    phase: 0,
    t: at(0.05),
    text: `조성 범위 ${run.spec.elements.map((e) => `${e} ${run.spec.ranges[e]?.min}–${run.spec.ranges[e]?.max}`).join(", ")}`,
    tone: "muted",
  });
  L.push({ phase: 0, t: at(0.15), text: `조성 격자 생성 · ${s.total.toLocaleString()}개 (Σ = 100 at%)` });
  L.push({ phase: 1, t: at(0.3), text: "Descriptor 계산 · VEC, δ, ΔHmix, ΔSmix, Ω, Tm, ρ" });
  PHASE_RULES.forEach((r, i) => {
    const fail = s.ruleFail[r.key] ?? 0;
    L.push({
      phase: 2,
      t: at(0.4 + i * 0.05),
      text: `규칙 ${r.criterion} — 통과 ${(s.total - fail).toLocaleString()}, 제외 ${fail.toLocaleString()}`,
      tone: fail > 0 ? undefined : "muted",
    });
  });
  L.push({ phase: 2, t: at(0.62), text: `고용체 규칙 전체 통과 · ${s.phasePass.toLocaleString()}개`, tone: "ok" });
  L.push({ phase: 3, t: at(0.7), text: `예측 · ${MODEL_CARD.name} ${MODEL_CARD.version}` });
  L.push({
    phase: 3,
    t: at(0.85),
    text: `목표 충족 (YS ≥ ${t.ys} MPa, EL ≥ ${t.el} %${t.rhoMax != null ? `, ρ ≤ ${t.rhoMax}` : ""}) · ${s.meetsTarget.toLocaleString()}개`,
    tone: s.meetsTarget > 0 ? "ok" : "warn",
  });
  L.push({ phase: 3, t: at(0.93), text: `파레토 최적 (YS, EL) · ${s.pareto}개`, tone: "ok" });
  L.push({ phase: 3, t: at(1), text: `완료 · 계산 시간 ${s.ms} ms` });
  return L;
}

const toneColor = (tone?: Line["tone"]) =>
  tone === "ok"
    ? "var(--color-success)"
    : tone === "warn"
    ? "var(--color-warning)"
    : tone === "muted"
    ? "var(--color-text-muted)"
    : "var(--color-text)";

export function RunLog() {
  const { run, ds } = useActiveRun();
  const setView = useResearchStore((s) => s.setView);
  const lastRunStartedAt = useResearchStore((s) => s.lastRunStartedAt);
  const [fresh, setFresh] = useState(() => Date.now() - lastRunStartedAt < 3000);
  const lines = useMemo(() => (run && ds ? buildLines(run, ds) : []), [run, ds]);

  if (!run || !ds) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader index="2" title="계산 로그" />
        <EmptyState
          title="실행된 계산이 없습니다"
          desc="설계 조건을 정하고 계산을 실행하면 단계별 로그가 기록됩니다."
          action={<Btn onClick={() => setView("setup")}>설계 조건으로</Btn>}
        />
      </div>
    );
  }

  if (fresh) {
    return (
      <SynthesisTransition
        run={run}
        lines={lines}
        onDone={() => {
          setFresh(false);
          setView("explore");
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        index="2"
        title={`계산 로그 · ${run.id}`}
        desc="각 단계의 통과·제외 개수를 기록합니다. 같은 조건으로 다시 실행하면 같은 결과가 나옵니다."
        right={
          <Btn variant="primary" size="md" onClick={() => setView("explore")}>
            탐색 공간 보기 →
          </Btn>
        }
      />
      <Panel bodyClass="pt-3">
        <LogList lines={lines} />
      </Panel>
      {run.spec.hypothesis && (
        <Panel title="이 Run의 가설" className="mt-5">
          <p className="text-sm">{run.spec.hypothesis}</p>
        </Panel>
      )}
    </div>
  );
}

function LogList({ lines }: { lines: Line[] }) {
  return (
    <div className="font-mono text-[0.78125rem] leading-7">
      {lines.map((l, i) => (
        <div key={i} className="fade-up flex gap-3">
          <span className="shrink-0 text-text-muted">{l.t}</span>
          <span style={{ color: toneColor(l.tone) }}>{l.text}</span>
        </div>
      ))}
    </div>
  );
}

const PHASES = [
  { en: "Atomic orbitals", ko: "원자 준비 · 조성 격자 생성" },
  { en: "Electron sharing", ko: "전자 공유 · descriptor 계산" },
  { en: "Metallic bonding", ko: "금속 결합 · 고용체 규칙 판별" },
  { en: "BCC lattice", ko: "격자 형성 · 물성 예측과 순위" },
];
const STEP_MS = 1100;
const TOTAL_MS = STEP_MS * PHASES.length;

function SynthesisTransition({ run, lines, onDone }: { run: Run; lines: Line[]; onDone: () => void }) {
  const theme = useResearchStore((s) => s.theme);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => setElapsed(performance.now() - start), 80);
    return () => window.clearInterval(id);
  }, []);

  const fired = useRef(false);
  useEffect(() => {
    if (!fired.current && elapsed > TOTAL_MS + 1500) {
      fired.current = true;
      onDone();
    }
  }, [elapsed, onDone]);

  const phase = Math.min(PHASES.length - 1, Math.floor(elapsed / STEP_MS));
  const done = elapsed > TOTAL_MS + 200;
  // reveal each line during its phase
  const visible = lines.filter((l) => {
    const inPhase = lines.filter((x) => x.phase === l.phase);
    const k = inPhase.indexOf(l);
    return elapsed >= l.phase * STEP_MS + (k / inPhase.length) * STEP_MS;
  });

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center gap-8 py-6">
      <div className="flex flex-col items-center gap-4">
        <SynthesisCanvas symbols={run.spec.elements} totalMs={TOTAL_MS} theme={theme} className="h-60 w-60 sm:h-72 sm:w-72" />
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-sm">
          {run.spec.elements.map((e, i) => (
            <span key={e} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-text-muted">+</span>}
              <span className="flex items-center gap-1 font-semibold">
                {e}
              </span>
            </span>
          ))}
          <span className={`ml-1 text-text-muted transition-opacity duration-500 ${phase >= 3 ? "opacity-100" : "opacity-0"}`}>
            → <span className="font-semibold text-text">BCC 고용체</span>
          </span>
        </div>
      </div>

      <div className="w-full">
        <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-accent">
          {String(phase + 1).padStart(2, "0")} · {PHASES[phase].en}
        </div>
        <div key={phase} className="fade-up mb-4 text-lg font-semibold">
          {done ? "계산 완료" : PHASES[phase].ko}
        </div>

        <div className="mb-4 flex gap-1.5">
          {PHASES.map((_, i) => (
            <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-100"
                style={{ width: `${Math.min(100, Math.max(0, ((elapsed - i * STEP_MS) / STEP_MS) * 100))}%` }}
              />
            </div>
          ))}
        </div>

        <div className="h-56 overflow-hidden border-l-2 border-border pl-4">
          <div className="font-mono text-[0.71875rem] leading-6">
            {visible.slice(-11).map((l, i) => (
              <div key={`${l.t}-${i}`} className="fade-up truncate">
                <span className="text-text-muted">{l.t.slice(3)}</span>{" "}
                <span style={{ color: toneColor(l.tone) }}>{l.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs">
          <span className={done ? "font-medium text-success" : "text-text-muted"}>
            {done ? "탐색 공간으로 이동합니다…" : `${run.id} 계산 중…`}
          </span>
          <button onClick={onDone} className="text-text-muted underline underline-offset-2 hover:text-text">
            건너뛰기
          </button>
        </div>
      </div>
    </div>
  );
}
