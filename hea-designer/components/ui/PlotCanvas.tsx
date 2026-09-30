"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PlotPoint {
  x: number;
  y: number;
  color: string;
  r?: number;
  shape?: "circle" | "square" | "diamond";
  hollow?: boolean;
  label?: string;
  ex?: number; // symmetric error in x
  ey?: number; // symmetric error in y
  key?: string | number;
  tooltip?: string[];
}

export interface PlotLayer {
  points: PlotPoint[];
  interactive?: boolean;
  alpha?: number;
}

interface Props {
  title: string;
  xLabel: string;
  yLabel: string;
  xDomain: [number, number];
  yDomain: [number, number];
  layers: PlotLayer[];
  region?: { x0: number; x1: number; y0: number; y1: number; label?: string };
  vLines?: { x: number; label: string }[];
  hLines?: { y: number; label: string }[];
  polyline?: { pts: [number, number][]; color: string; label?: string };
  diagonal?: boolean;
  height?: number;
  fileName?: string;
  themeKey?: string;
  legend?: { color: string; label: string; shape?: PlotPoint["shape"]; hollow?: boolean }[];
  onPick?: (p: PlotPoint) => void;
  headerExtra?: React.ReactNode;
  bare?: boolean;
}

function niceTicks(min: number, max: number, count = 6) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

const M = { l: 58, r: 16, t: 14, b: 44 };

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function PlotCanvas(props: Props) {
  const {
    title, xLabel, yLabel, xDomain, yDomain, layers, region, vLines, hLines, polyline, diagonal,
    height = 320, fileName = "figure", themeKey, legend, onPick, headerExtra, bare,
  } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<{ p: PlotPoint; px: number; py: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(280, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sx = useCallback(
    (x: number) => M.l + ((x - xDomain[0]) / (xDomain[1] - xDomain[0])) * (width - M.l - M.r),
    [width, xDomain]
  );
  const sy = useCallback(
    (y: number) => M.t + (1 - (y - yDomain[0]) / (yDomain[1] - yDomain[0])) * (height - M.t - M.b),
    [height, yDomain]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const C = {
      bg: css("--color-surface"),
      grid: css("--color-grid"),
      border: css("--color-border"),
      text: css("--color-text"),
      muted: css("--color-text-muted"),
      accent: css("--color-accent"),
      accentSoft: css("--color-accent-soft"),
      danger: css("--color-danger"),
    };
    const mono = css("--font-mono") || "monospace";
    const sans = css("--font-sans") || "sans-serif";

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, width, height);

    const x0 = M.l, x1 = width - M.r, y0 = M.t, y1 = height - M.b;

    // grid + ticks
    ctx.font = `11px ${mono}`;
    ctx.fillStyle = C.muted;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    const xt = niceTicks(xDomain[0], xDomain[1]);
    const yt = niceTicks(yDomain[0], yDomain[1]);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    xt.forEach((t) => {
      const X = Math.round(sx(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(X, y0); ctx.lineTo(X, y1); ctx.stroke();
      ctx.fillText(String(t), X, y1 + 5);
    });
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    yt.forEach((t) => {
      const Y = Math.round(sy(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x0, Y); ctx.lineTo(x1, Y); ctx.stroke();
      ctx.fillText(String(t), x0 - 6, Y);
    });

    // axes frame
    ctx.strokeStyle = C.border;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);

    // axis labels
    ctx.fillStyle = C.text;
    ctx.font = `12px ${sans}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(xLabel, (x0 + x1) / 2, height - 8);
    ctx.save();
    ctx.translate(14, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();

    if (region) {
      const rx0 = sx(region.x0), rx1 = sx(region.x1), ry0 = sy(region.y1), ry1 = sy(region.y0);
      ctx.fillStyle = C.accentSoft;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
      ctx.globalAlpha = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = C.accent;
      ctx.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
      ctx.setLineDash([]);
      if (region.label) {
        ctx.fillStyle = C.accent;
        ctx.font = `11px ${sans}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(region.label, Math.max(rx0, x0) + 4, Math.max(ry0, y0) + 4);
      }
    }

    const refLine = (x: number | null, y: number | null, label: string) => {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = C.danger;
      ctx.beginPath();
      if (x != null) { ctx.moveTo(sx(x), y0); ctx.lineTo(sx(x), y1); }
      if (y != null) { ctx.moveTo(x0, sy(y)); ctx.lineTo(x1, sy(y)); }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.danger;
      ctx.font = `11px ${sans}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      if (x != null) {
        const w = ctx.measureText(label).width;
        if (sx(x) + 4 + w > x1) {
          ctx.textAlign = "right";
          ctx.fillText(label, sx(x) - 4, y0 + 4);
          ctx.textAlign = "left";
        } else ctx.fillText(label, sx(x) + 4, y0 + 4);
      }
      if (y != null) ctx.fillText(label, x0 + 4, sy(y) + 3);
    };
    vLines?.forEach((l) => refLine(l.x, null, l.label));
    hLines?.forEach((l) => refLine(null, l.y, l.label));

    if (diagonal) {
      ctx.strokeStyle = C.muted;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      const lo = Math.max(xDomain[0], yDomain[0]);
      const hi = Math.min(xDomain[1], yDomain[1]);
      ctx.moveTo(sx(lo), sy(lo));
      ctx.lineTo(sx(hi), sy(hi));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    layers.forEach((layer) => {
      ctx.globalAlpha = layer.alpha ?? 1;
      layer.points.forEach((p) => {
        const X = sx(p.x), Y = sy(p.y), r = p.r ?? 2.2;
        if (p.ex || p.ey) {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (p.ex) { ctx.moveTo(sx(p.x - p.ex), Y); ctx.lineTo(sx(p.x + p.ex), Y); }
          if (p.ey) { ctx.moveTo(X, sy(p.y - p.ey)); ctx.lineTo(X, sy(p.y + p.ey)); }
          ctx.stroke();
        }
        ctx.beginPath();
        if (p.shape === "square") ctx.rect(X - r, Y - r, r * 2, r * 2);
        else if (p.shape === "diamond") {
          ctx.moveTo(X, Y - r * 1.3); ctx.lineTo(X + r * 1.3, Y); ctx.lineTo(X, Y + r * 1.3); ctx.lineTo(X - r * 1.3, Y); ctx.closePath();
        } else ctx.arc(X, Y, r, 0, Math.PI * 2);
        if (p.hollow) {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = p.color;
          ctx.fill();
        }
        if (p.label) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = C.text;
          ctx.font = `600 10px ${mono}`;
          ctx.textAlign = "left";
          ctx.textBaseline = "bottom";
          ctx.fillText(p.label, X + r + 3, Y - 2);
          ctx.globalAlpha = layer.alpha ?? 1;
        }
      });
      ctx.globalAlpha = 1;
    });

    if (polyline && polyline.pts.length > 1) {
      ctx.strokeStyle = polyline.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      polyline.pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
      ctx.stroke();
    }
    ctx.restore();
  }, [width, height, layers, region, vLines, hLines, polyline, diagonal, xDomain, yDomain, xLabel, yLabel, sx, sy, themeKey]);

  const findNearest = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best: PlotPoint | null = null;
    let bd = 64;
    for (let li = layers.length - 1; li >= 0; li--) {
      if (!layers[li].interactive) continue;
      for (const p of layers[li].points) {
        const dx = sx(p.x) - mx, dy = sy(p.y) - my;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = p; }
      }
      if (best) break;
    }
    return best ? { p: best, px: sx(best.x), py: sy(best.y) } : null;
  };

  const exportPng = () => {
    const url = canvasRef.current?.toDataURL("image/png");
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.png`;
    a.click();
  };

  return (
    <div className={bare ? "" : "border-t border-border pt-2"}>
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 pt-2">
        <span className="text-sm font-semibold">{title}</span>
        <div className="no-print flex items-center gap-3">
          {headerExtra}
          <button onClick={exportPng} className="text-xs text-text-muted hover:text-accent">
            PNG 저장
          </button>
        </div>
      </div>
      <div ref={wrapRef} className="relative pt-1">
        <canvas
          ref={canvasRef}
          className={onPick ? "cursor-crosshair" : ""}
          onMouseMove={(e) => setHover(findNearest(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const h = findNearest(e);
            if (h && onPick) onPick(h.p);
          }}
        />
        {hover?.p.tooltip && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg"
            style={{
              left: Math.min(hover.px + 12, width - 180),
              top: Math.max(0, hover.py - 10),
            }}
          >
            {hover.p.tooltip.map((l, i) => (
              <div key={i} className={i === 0 ? "num font-semibold" : "num text-text-muted"}>
                {l}
              </div>
            ))}
          </div>
        )}
      </div>
      {legend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pb-3 pt-1 text-xs text-text-muted">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span
                className={l.shape === "square" ? "h-2 w-2" : "h-2 w-2 rounded-full"}
                style={l.hollow ? { border: `1.5px solid ${l.color}` } : { background: l.color }}
              />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
