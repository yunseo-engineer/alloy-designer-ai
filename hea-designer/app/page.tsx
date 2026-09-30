"use client";

import { useEffect, useState } from "react";
import { useResearchStore } from "@/store/useResearchStore";
import { AppShell } from "@/components/shell/AppShell";

export default function Home() {
  const [hydrated, setHydrated] = useState(false);
  const theme = useResearchStore((s) => s.theme);

  useEffect(() => {
    Promise.resolve(useResearchStore.persist.rehydrate()).finally(() => {
      document.documentElement.dataset.theme = useResearchStore.getState().theme;
      document.documentElement.style.fontSize = `${useResearchStore.getState().fontScale ?? 100}%`;
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  if (!hydrated) {
    return <div className="p-6 text-xs text-text-muted">세션 불러오는 중…</div>;
  }
  return <AppShell />;
}
