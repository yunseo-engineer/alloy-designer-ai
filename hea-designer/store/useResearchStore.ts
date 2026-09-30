import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Composition } from "@/lib/descriptors";
import { autoRange, resolveSpec, type DesignSpec, type ElementRange } from "@/lib/designSpace";
import type { PhaseLabel } from "@/lib/literature";

export type View =
  | "setup"
  | "run"
  | "explore"
  | "specimens"
  | "plan"
  | "results"
  | "literature"
  | "notebook";

export interface Run {
  id: string; // R-001
  createdAt: string; // ISO
  spec: DesignSpec;
}

export type SpecimenStatus = "계획" | "용해 완료" | "시험 완료";

export interface Measurement {
  phase: PhaseLabel | "";
  ys: number | null;
  el: number | null;
  hv: number | null;
  date: string;
  note: string;
}

export interface LabLog {
  operator: string;
  weighed: Record<string, string>; // element → measured mass (g), as typed
  lots: Record<string, string>; // element → raw-material lot no.
  steps: Record<string, { done: boolean; actual: string }>;
  tests: Record<string, { done: boolean; date: string }>;
}

export const EMPTY_LOG: LabLog = { operator: "", weighed: {}, lots: {}, steps: {}, tests: {} };

export interface Specimen {
  id: string; // HEA-260927-01
  runId: string | null;
  origin: string; // e.g. "파레토 최적", "수동 편집"
  createdAt: string;
  composition: Composition;
  status: SpecimenStatus;
  memo: string;
  measured: Measurement | null;
  log?: LabLog;
}

export interface NoteEntry {
  id: number;
  at: string;
  kind: "run" | "specimen" | "result" | "memo" | "status";
  text: string;
}

export const DEFAULT_SPEC: DesignSpec = {
  elements: [],
  rangeMode: "auto",
  ranges: {},
  step: 5,
  targets: { ys: 1000, el: 30, rhoMax: null, useTemp: 25 },
  hypothesis: "",
};

interface ResearchState {
  projectName: string;
  theme: "light" | "dark";
  fontScale: number; // % of browser default (100 = 16px root)
  view: View;
  draft: DesignSpec;
  runs: Run[];
  activeRunId: string | null;
  specimens: Specimen[];
  activeSpecimenId: string | null;
  notes: NoteEntry[];
  seq: { specimen: number; note: number };
  lastRunStartedAt: number;

  setProjectName: (name: string) => void;
  setTheme: (t: "light" | "dark") => void;
  setFontScale: (pct: number) => void;
  setView: (v: View) => void;

  toggleElement: (symbol: string) => void;
  setElements: (symbols: string[], ranges?: Record<string, ElementRange>) => void;
  setRangeMode: (mode: DesignSpec["rangeMode"]) => void;
  setRange: (symbol: string, patch: Partial<ElementRange>) => void;
  setDraft: (patch: Partial<DesignSpec>) => void;
  setTargets: (patch: Partial<DesignSpec["targets"]>) => void;
  loadRunIntoDraft: (runId: string) => void;

  startRun: () => void;
  setActiveRun: (id: string | null) => void;

  addSpecimen: (composition: Composition, origin: string, runId: string | null) => string;
  updateSpecimen: (id: string, patch: Partial<Omit<Specimen, "id">>) => void;
  removeSpecimen: (id: string) => void;
  setActiveSpecimen: (id: string | null) => void;
  saveMeasurement: (id: string, m: Measurement) => void;
  updateLog: (id: string, fn: (log: LabLog) => LabLog, note?: string) => void;

  addNote: (kind: NoteEntry["kind"], text: string) => void;
  removeNote: (id: number) => void;

  newDesign: () => void;
  resetSession: () => void;
  importSession: (data: unknown) => string | null;
}

export interface SessionFile {
  app: string;
  exportedAt?: string;
  projectName?: string;
  runs: Run[];
  specimens: Specimen[];
  notes: NoteEntry[];
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function todayStamp() {
  const d = new Date();
  return `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

export const useResearchStore = create<ResearchState>()(
  persist(
    (set, get) => ({
      projectName: "BCC HEA 강도–연성 설계",
      theme: "light",
      fontScale: 100,
      view: "setup",
      draft: DEFAULT_SPEC,
      runs: [],
      activeRunId: null,
      specimens: [],
      activeSpecimenId: null,
      notes: [],
      seq: { specimen: 0, note: 0 },
      lastRunStartedAt: 0,

      setProjectName: (projectName) => set({ projectName }),
      setTheme: (theme) => {
        document.documentElement.dataset.theme = theme;
        set({ theme });
      },
      setView: (view) => set({ view }),
      setFontScale: (pct) => {
        const v = Math.min(140, Math.max(80, pct));
        document.documentElement.style.fontSize = `${v}%`;
        set({ fontScale: v });
      },

      toggleElement: (symbol) =>
        set((s) => {
          const has = s.draft.elements.includes(symbol);
          const elements = has ? s.draft.elements.filter((e) => e !== symbol) : [...s.draft.elements, symbol];
          const ranges = { ...s.draft.ranges };
          if (!has && !ranges[symbol]) ranges[symbol] = autoRange(elements.length);
          return { draft: { ...s.draft, elements, ranges } };
        }),

      setElements: (symbols, ranges) =>
        set((s) => ({
          draft: {
            ...s.draft,
            elements: symbols,
            rangeMode: ranges ? s.draft.rangeMode : "auto",
            ranges: ranges ?? Object.fromEntries(symbols.map((e) => [e, autoRange(symbols.length)])),
          },
        })),

      setRangeMode: (mode) =>
        set((s) => {
          if (mode === "custom") {
            const resolved = resolveSpec({ ...s.draft, rangeMode: "auto" });
            return { draft: { ...s.draft, rangeMode: "custom", ranges: resolved.ranges, step: resolved.step } };
          }
          return { draft: { ...s.draft, rangeMode: "auto" } };
        }),

      setRange: (symbol, patch) =>
        set((s) => ({
          draft: {
            ...s.draft,
            ranges: { ...s.draft.ranges, [symbol]: { ...(s.draft.ranges[symbol] ?? { min: 0, max: 100 }), ...patch } },
          },
        })),

      setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
      setTargets: (patch) => set((s) => ({ draft: { ...s.draft, targets: { ...s.draft.targets, ...patch } } })),

      loadRunIntoDraft: (runId) => {
        const run = get().runs.find((r) => r.id === runId);
        if (run) set({ draft: { ...structuredClone(run.spec), rangeMode: run.spec.rangeMode ?? "custom" }, view: "setup" });
      },

      startRun: () => {
        const { runs, draft } = get();
        const id = `R-${pad(runs.length + 1, 3)}`;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { count, ...resolved } = resolveSpec(draft);
        const run: Run = { id, createdAt: new Date().toISOString(), spec: structuredClone(resolved) };
        set({ runs: [...runs, run], activeRunId: id, view: "run", lastRunStartedAt: Date.now() });
        const r = resolved.ranges;
        get().addNote(
          "run",
          `${id} 실행 · ${draft.elements.map((e) => `${e}[${r[e]?.min}–${r[e]?.max}]`).join(" ")} · ${resolved.step} at% 간격${draft.rangeMode === "auto" ? " (자동)" : ""} · 목표 YS ≥ ${draft.targets.ys} MPa, EL ≥ ${draft.targets.el} %` +
            (draft.hypothesis ? ` · 가설: ${draft.hypothesis}` : "")
        );
      },

      setActiveRun: (activeRunId) => set({ activeRunId }),

      addSpecimen: (composition, origin, runId) => {
        const n = get().seq.specimen + 1;
        const id = `HEA-${todayStamp()}-${pad(n)}`;
        const sp: Specimen = {
          id,
          runId,
          origin,
          createdAt: new Date().toISOString(),
          composition,
          status: "계획",
          memo: "",
          measured: null,
        };
        set((s) => ({ specimens: [...s.specimens, sp], seq: { ...s.seq, specimen: n }, activeSpecimenId: id }));
        const f = Object.entries(composition)
          .map(([k, v]) => `${k}${v}`)
          .join("");
        get().addNote("specimen", `${id} 등록 · ${f} (${origin}${runId ? `, ${runId}` : ""})`);
        return id;
      },

      updateSpecimen: (id, patch) => {
        const prev = get().specimens.find((s) => s.id === id);
        set((s) => ({ specimens: s.specimens.map((sp) => (sp.id === id ? { ...sp, ...patch } : sp)) }));
        if (prev && patch.status && patch.status !== prev.status) {
          get().addNote("status", `${id} 상태 변경 · ${prev.status} → ${patch.status}`);
        }
      },

      removeSpecimen: (id) =>
        set((s) => ({
          specimens: s.specimens.filter((sp) => sp.id !== id),
          activeSpecimenId: s.activeSpecimenId === id ? null : s.activeSpecimenId,
        })),

      setActiveSpecimen: (activeSpecimenId) => set({ activeSpecimenId }),

      updateLog: (id, fn, note) => {
        set((s) => ({
          specimens: s.specimens.map((sp) => {
            if (sp.id !== id) return sp;
            const log = fn(sp.log ?? EMPTY_LOG);
            // melting checked → specimen is at least "용해 완료"
            const status = log.steps["용해"]?.done && sp.status === "계획" ? "용해 완료" : sp.status;
            return { ...sp, log, status };
          }),
        }));
        if (note) get().addNote("status", `${id} ${note}`);
      },

      saveMeasurement: (id, m) => {
        set((s) => ({
          specimens: s.specimens.map((sp) =>
            sp.id === id ? { ...sp, measured: m, status: m.ys != null || m.el != null ? "시험 완료" : sp.status } : sp
          ),
        }));
        const parts = [
          m.phase && `상 ${m.phase}`,
          m.ys != null && `YS ${m.ys} MPa`,
          m.el != null && `EL ${m.el} %`,
          m.hv != null && `${m.hv} HV`,
        ].filter(Boolean);
        get().addNote("result", `${id} 실측 입력 · ${parts.join(", ")}${m.note ? ` · ${m.note}` : ""}`);
      },

      addNote: (kind, text) =>
        set((s) => {
          const id = s.seq.note + 1;
          return {
            notes: [{ id, at: new Date().toISOString(), kind, text }, ...s.notes],
            seq: { ...s.seq, note: id },
          };
        }),

      removeNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),

      newDesign: () =>
        set((s) => ({
          draft: { ...DEFAULT_SPEC, targets: { ...s.draft.targets } },
          activeRunId: null,
          view: "setup",
        })),

      resetSession: () =>
        set({
          draft: DEFAULT_SPEC,
          runs: [],
          activeRunId: null,
          specimens: [],
          activeSpecimenId: null,
          notes: [],
          seq: { specimen: 0, note: 0 },
          view: "setup",
          lastRunStartedAt: 0,
        }),

      importSession: (data) => {
        const d = data as Partial<SessionFile> | null;
        if (!d || d.app !== "hea-designer-v2" || !Array.isArray(d.runs) || !Array.isArray(d.specimens) || !Array.isArray(d.notes)) {
          return "HEA Designer v2에서 내보낸 세션 파일이 아닙니다.";
        }
        const specSeq = d.specimens.reduce((m, sp) => Math.max(m, Number(sp.id.split("-").pop()) || 0), 0);
        const noteSeq = d.notes.reduce((m, n) => Math.max(m, n.id), 0);
        set({
          projectName: d.projectName ?? get().projectName,
          runs: d.runs,
          specimens: d.specimens,
          notes: d.notes,
          activeRunId: d.runs[d.runs.length - 1]?.id ?? null,
          activeSpecimenId: null,
          seq: { specimen: specSeq, note: noteSeq },
          view: d.runs.length ? "explore" : "setup",
          lastRunStartedAt: 0,
        });
        get().addNote("memo", `세션 불러오기 · Run ${d.runs.length}건, 시편 ${d.specimens.length}건${d.exportedAt ? ` (${d.exportedAt.slice(0, 10)} 저장본)` : ""}`);
        return null;
      },
    }),
    {
      name: "hea-designer-v2",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { lastRunStartedAt, ...rest } = s;
        return rest;
      },
    }
  )
);
