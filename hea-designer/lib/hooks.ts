"use client";

import { useMemo } from "react";
import { useResearchStore } from "@/store/useResearchStore";
import { computeDesignSpace } from "./designSpace";

export function useActiveRun() {
  const runs = useResearchStore((s) => s.runs);
  const activeRunId = useResearchStore((s) => s.activeRunId);
  const run = runs.find((r) => r.id === activeRunId) ?? null;
  const ds = useMemo(() => (run ? computeDesignSpace(run.spec, run.id) : null), [run]);
  return { run, ds };
}

/** Targets used when judging specimens: from their run if any, else current draft. */
export function useTargetsFor(runId: string | null) {
  const runs = useResearchStore((s) => s.runs);
  const draft = useResearchStore((s) => s.draft);
  return runs.find((r) => r.id === runId)?.spec.targets ?? draft.targets;
}

// Mirrors the tokens in app/globals.css for canvas drawing (canvas cannot read CSS vars).
const PALETTES = {
  light: {
    text: "#1c1c1c", "text-muted": "#6b6b6b", accent: "#1c2b48", success: "#1c2b48", warning: "#b3261e",
    danger: "#b3261e", point: "#c9c9c9", "point-pass": "#8c8c8c", border: "#dddddd",
  },
  dark: {
    text: "#e6e6e6", "text-muted": "#9a9a9a", accent: "#9fb0cf", success: "#9fb0cf", warning: "#ef6b62",
    danger: "#ef6b62", point: "#444444", "point-pass": "#7a7a7a", border: "#363636",
  },
} as const;
export type ThemeColors = Record<keyof (typeof PALETTES)["light"], string>;

export function useThemeColors(): ThemeColors {
  const theme = useResearchStore((s) => s.theme);
  return PALETTES[theme];
}
