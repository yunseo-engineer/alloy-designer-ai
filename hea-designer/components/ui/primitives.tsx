"use client";

import { useState, type ReactNode } from "react";
import type { Composition } from "@/lib/descriptors";

export function Panel({
  title,
  desc,
  right,
  children,
  className = "",
  bodyClass = "pt-3",
}: {
  title?: ReactNode;
  desc?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`border-t border-border pt-4 ${className}`}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            {desc && <p className="mt-0.5 text-xs text-text-muted">{desc}</p>}
          </div>
          {right && <div className="no-print flex flex-wrap items-center gap-2">{right}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function PageHeader({ index, title, desc, right }: { index?: string; title: string; desc?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {index && <div className="mb-1 text-xs font-medium text-accent">STEP {index}</div>}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {desc && <p className="mt-1 max-w-2xl text-sm text-text-muted">{desc}</p>}
      </div>
      {right && <div className="no-print flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = "default",
  size = "sm",
  disabled,
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const styles = {
    default: "border border-border bg-surface hover:border-text-muted",
    primary: "bg-accent text-white hover:brightness-110 shadow-sm",
    ghost: "text-text-muted hover:text-accent",
    danger: "border border-border text-danger hover:border-danger",
  }[variant];
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-9 px-4 text-sm", lg: "h-11 px-5 text-sm font-medium" }[size];
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${sizes} ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/** One label–value row. Stack several inside <StatList> — always a single column. */
export function Stat({ label, value, unit, sub, tone }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: "accent" | "success" }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border py-2.5">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="flex items-baseline gap-2">
        {sub && <span className="text-xs text-text-muted">{sub}</span>}
        <span
          className="num text-lg font-medium"
          style={{ color: tone === "success" ? "var(--color-success)" : tone === "accent" ? "var(--color-accent)" : undefined }}
        >
          {value}
        </span>
        {unit && <span className="text-xs text-text-muted">{unit}</span>}
      </span>
    </div>
  );
}

/** Summary tile for side-by-side stat rows (steps 1–3). */
export function StatBlock({ label, value, unit, sub, tone }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: "accent" | "success" }) {
  return (
    <div className="border-l-2 border-border py-1 pl-4">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className="num text-2xl font-medium"
          style={{ color: tone === "success" ? "var(--color-success)" : tone === "accent" ? "var(--color-accent)" : undefined }}
        >
          {value}
        </span>
        {unit && <span className="text-xs text-text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs text-text-muted">{sub}</div>}
    </div>
  );
}

export function StatList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`border-t border-border ${className}`}>{children}</div>;
}

/** Ti₃₀Zr₂₀… style formula with subscript at%. */
export function Formula({ c, className = "" }: { c: Composition; className?: string }) {
  return (
    <span className={`num whitespace-nowrap ${className}`}>
      {Object.entries(c)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => (
          <span key={k}>
            {k}
            <sub className="text-[0.7em] text-text-muted">{Number(v.toFixed(1))}</sub>
          </span>
        ))}
    </span>
  );
}

const TONES = {
  ink: "var(--color-text)",
  muted: "var(--color-text-muted)",
  accent: "var(--color-accent)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
};

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  const color = TONES[tone];
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-px text-[0.6875rem] font-medium leading-5"
      style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      {children}
    </span>
  );
}

export function PassMark({ pass }: { pass: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: pass ? "var(--color-success)" : "var(--color-danger)" }}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
      {pass ? "충족" : "미충족"}
    </span>
  );
}

export function EmptyState({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <div className="text-base font-medium">{title}</div>
      {desc && <div className="max-w-md text-sm text-text-muted">{desc}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Typed numeric input (text field — no spinner arrows, no wheel/arrow-key stepping). */
export function NumInput({
  value,
  onChange,
  width = "w-20",
  placeholder,
  allowEmpty,
  size = "sm",
  className = "",
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  width?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  size?: "sm" | "lg";
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null); // text while editing
  const shown = draft ?? (value == null ? "" : String(value));
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={`field num text-right ${size === "lg" ? "h-10 text-base" : "text-xs"} ${width} ${className}`}
      value={shown}
      placeholder={placeholder}
      onFocus={() => setDraft(value == null ? "" : String(value))}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        const raw = e.target.value.replace(",", ".");
        if (!/^-?\d*\.?\d*$/.test(raw)) return; // digits, one dot, optional minus
        setDraft(raw);
        if (raw === "" || raw === "-" || raw === ".") {
          if (raw === "" && allowEmpty) onChange(null);
          return;
        }
        const n = parseFloat(raw);
        if (!Number.isNaN(n)) onChange(n);
      }}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-xs transition ${
            value === o.value ? "bg-surface font-medium text-text shadow-sm" : "text-text-muted hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: (string | number | null | undefined)[][]) {
  return (
    "﻿" +
    rows
      .map((r) =>
        r
          .map((v) => {
            const s = v == null ? "" : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",")
      )
      .join("\n")
  );
}

export function fmtTime(iso: string, withSeconds = false) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}${
    withSeconds ? `:${p(d.getSeconds())}` : ""
  }`;
}
