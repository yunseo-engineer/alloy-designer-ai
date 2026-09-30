"use client";

import { useMemo, useState } from "react";
import { useResearchStore, type NoteEntry } from "@/store/useResearchStore";
import { Btn, PageHeader, Tag, downloadText, fmtTime } from "@/components/ui/primitives";

const KIND: Record<NoteEntry["kind"], { label: string; tone: "muted" | "accent" | "success" | "warning" | "ink" }> = {
  run: { label: "계산", tone: "accent" },
  specimen: { label: "시편", tone: "muted" },
  status: { label: "상태", tone: "muted" },
  result: { label: "실측", tone: "success" },
  memo: { label: "메모", tone: "ink" },
};

export function Notebook() {
  const notes = useResearchStore((s) => s.notes);
  const addNote = useResearchStore((s) => s.addNote);
  const removeNote = useResearchStore((s) => s.removeNote);
  const projectName = useResearchStore((s) => s.projectName);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"" | NoteEntry["kind"]>("");

  const grouped = useMemo(() => {
    const list = kind ? notes.filter((n) => n.kind === kind) : notes;
    const g = new Map<string, NoteEntry[]>();
    list.forEach((n) => {
      const day = fmtTime(n.at).slice(0, 10);
      g.set(day, [...(g.get(day) ?? []), n]);
    });
    return [...g.entries()];
  }, [notes, kind]);

  const submit = () => {
    if (!text.trim()) return;
    addNote("memo", text.trim());
    setText("");
  };

  const exportMd = () => {
    const lines = [`# ${projectName} — 연구 노트`, ""];
    [...grouped].forEach(([day, entries]) => {
      lines.push(`## ${day}`, "");
      entries.forEach((n) => lines.push(`- \`${fmtTime(n.at).slice(11)}\` **[${KIND[n.kind].label}]** ${n.text}`));
      lines.push("");
    });
    downloadText(`${projectName.replace(/\s+/g, "_")}_notebook.md`, lines.join("\n"), "text/markdown");
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="연구 노트"
        desc="계산 실행, 시편 등록, 상태 변경, 실측 입력이 자동으로 기록됩니다. 관찰 내용은 메모로 추가하세요."
        right={
          <>
            <select className="field text-[0.6875rem]" value={kind} onChange={(e) => setKind(e.target.value as NoteEntry["kind"] | "")}>
              <option value="">전체</option>
              {Object.entries(KIND).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
            <Btn onClick={exportMd} disabled={!notes.length}>Markdown 내보내기</Btn>
          </>
        }
      />

      <div className="mb-5 flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={2}
          placeholder="관찰·판단·다음 할 일을 기록하세요 (Ctrl+Enter로 저장)"
          className="field flex-1 resize-y text-xs"
        />
        <Btn variant="primary" onClick={submit} disabled={!text.trim()}>
          기록
        </Btn>
      </div>

      {grouped.length === 0 && <p className="text-xs text-text-muted">아직 기록이 없습니다.</p>}

      <div className="space-y-5">
        {grouped.map(([day, entries]) => (
          <section key={day}>
            <h3 className="num mb-2 border-b border-border pb-1 text-xs font-medium">{day}</h3>
            <ol className="space-y-1.5">
              {entries.map((n) => (
                <li key={n.id} className="group flex items-start gap-3 text-xs">
                  <span className="num w-12 shrink-0 pt-px text-[0.6875rem] text-text-muted">{fmtTime(n.at).slice(11)}</span>
                  <span className="w-10 shrink-0">
                    <Tag tone={KIND[n.kind].tone}>{KIND[n.kind].label}</Tag>
                  </span>
                  <span className="flex-1 leading-5">{n.text}</span>
                  {n.kind === "memo" && (
                    <button
                      onClick={() => removeNote(n.id)}
                      className="text-[0.6875rem] text-text-muted opacity-0 hover:text-danger group-hover:opacity-100"
                    >
                      삭제
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
