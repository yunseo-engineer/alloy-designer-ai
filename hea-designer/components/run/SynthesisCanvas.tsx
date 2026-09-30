"use client";

import { useEffect, useRef } from "react";
import { ELEMENT_PROPS, type ElementProps } from "@/lib/elementData";

/* ------------------------------------------------------------------ */
/* Canvas: atoms → shared electrons → electron sea → BCC unit cell     */
/* ------------------------------------------------------------------ */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOutBack = (t: number) => {
  const c = 1.6;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

function hexToRgb(hex: string) {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as const;
}
function rgba(hex: string, a: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function shade(hex: string, f: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

/** Valence electrons drawn around each nucleus (capped for legibility). */
function valenceCount(el: ElementProps | undefined) {
  if (!el) return 3;
  return Math.max(1, Math.min(6, el.vec));
}

// BCC unit cell: body center first, then the 8 corners.
const BCC_SITES: [number, number, number][] = [
  [0, 0, 0],
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];
const CUBE_EDGES: [number, number][] = [];
for (let a = 1; a < 9; a++) {
  for (let b = a + 1; b < 9; b++) {
    const diff = BCC_SITES[a].reduce((n, v, k) => n + (v !== BCC_SITES[b][k] ? 1 : 0), 0);
    if (diff === 1) CUBE_EDGES.push([a, b]);
  }
}

const THEMES = {
  dark: { accent: "#9FB0CF", success: "#9FB0CF", neutral: "#9A9A9A", electron: "#E6E6E6", label: "#FFFFFF", glow: 0.6, atoms: ["#6F82A6", "#6B6B6B", "#8C8C8C"] },
  light: { accent: "#1C2B48", success: "#1C2B48", neutral: "#8C8C8C", electron: "#1C2B48", label: "#FFFFFF", glow: 0.35, atoms: ["#1C2B48", "#3A3A3A", "#6B6B6B"] },
};
const TAU = Math.PI * 2;

export function SynthesisCanvas({
  symbols,
  totalMs,
  theme = "light",
  className = "h-72 w-72 sm:h-96 sm:w-96",
}: {
  symbols: string[];
  totalMs: number;
  theme?: "light" | "dark";
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const key = symbols.join(",");

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;

    const fontVar = getComputedStyle(document.documentElement).getPropertyValue("--font-inter").trim();
    const displayFont = fontVar ? `${fontVar}, Arial, sans-serif` : "Arial, sans-serif";
    const T = THEMES[theme];
    const ACCENT = T.accent;
    const SUCCESS = T.success;
    const NEUTRAL = T.neutral;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const speed = reduced ? 0.25 : 1;

    let size = 0;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      size = Math.min(rect.width, rect.height);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const list = symbols.length > 0 ? symbols : ["?"];
    const n = list.length;

    const atoms = list.map((symbol, i) => ({
      symbol,
      color: T.atoms[i % T.atoms.length],
      angle: (i / n) * TAU - Math.PI / 2,
      tilt: Math.random() * Math.PI,
      electrons: valenceCount(ELEMENT_PROPS[symbol]),
    }));

    type Electron = {
      atom: number;
      plane: number;
      phase: number;
      speed: number;
      seaTilt: number;
      seaPhase: number;
      seaSpeed: number;
      gas: [number, number, number, number];
      delay: number;
      trail: { x: number; y: number }[];
    };
    const electrons: Electron[] = [];
    atoms.forEach((a, i) => {
      for (let j = 0; j < a.electrons; j++) {
        const e = electrons.length;
        electrons.push({
          atom: i,
          plane: j % 3,
          phase: (j / a.electrons) * TAU + (j % 3) * 0.9,
          speed: 2.6 + Math.random() * 0.8,
          seaTilt: (e % 3) * (Math.PI / 3) + (Math.random() - 0.5) * 0.25,
          seaPhase: Math.random() * TAU,
          seaSpeed: (1.3 + Math.random() * 0.7) * (e % 2 ? 1 : -1),
          gas: [0.6 + Math.random() * 0.9, Math.random() * TAU, 0.6 + Math.random() * 0.9, Math.random() * TAU],
          delay: Math.random() * 0.08,
          trail: [],
        });
      }
    });

    const drawNucleus = (x: number, y: number, r: number, color: string, symbol: string, alpha: number) => {
      if (alpha <= 0.01 || r <= 0.5) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = color;
      ctx.shadowBlur = r * 1.4 * T.glow;
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(0.4, color);
      g.addColorStop(1, shade(color, 0.45));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (r >= 8) {
        ctx.fillStyle = T.label;
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 2;
        ctx.font = `600 ${Math.round(r * 0.82)}px ${displayFont}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(symbol, x, y + r * 0.04);
      }
      ctx.restore();
    };

    const start = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      const elapsed = now - start;
      const time = (elapsed / 1000) * speed;
      const p = clamp01(elapsed / totalMs);
      const cx = size / 2;
      const cy = size / 2;
      ctx.clearRect(0, 0, size, size);

      // ---- phase weights ----
      const kB = smooth(0.25, 0.48, p); // approach + bonding
      const kC = smooth(0.5, 0.72, p); // fuse into shared cloud
      const bondA = smooth(0.26, 0.38, p) * (1 - smooth(0.58, 0.7, p));
      const seaA = smooth(0.52, 0.7, p) * (1 - 0.75 * smooth(0.8, 0.95, p));
      const latA = smooth(0.8, 0.97, p);
      const gasK = smooth(0.8, 0.96, p);

      const doneAt = totalMs + 200;
      const bt = elapsed > doneAt ? clamp01((elapsed - doneAt) / 900) : 0;
      const burst = elapsed > doneAt ? 1 - bt : 0;

      // ---- background glow ----
      const glowA = 0.05 + 0.13 * smooth(0.45, 0.85, p) + 0.12 * burst;
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.48);
      bg.addColorStop(0, rgba(ACCENT, glowA));
      bg.addColorStop(1, rgba(ACCENT, 0));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);

      // faint guide ring
      ctx.save();
      ctx.setLineDash([3, 6]);
      ctx.lineDashOffset = -time * 8;
      ctx.strokeStyle = rgba(ACCENT, 0.18 * (1 - kC));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.36, 0, TAU);
      ctx.stroke();
      ctx.restore();

      // ---- lattice projection ----
      const yaw = time * 0.7;
      const pitch = 0.42 + 0.12 * Math.sin(time * 0.5);
      const cell = size * 0.16;
      const project = ([x, y, z]: [number, number, number]) => {
        const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
        const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
        const y1 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
        const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
        const s = 5 / (5 + z2);
        return { x: cx + x1 * cell * s, y: cy + y1 * cell * s, z: z2, s };
      };
      const sites = BCC_SITES.map(project);

      // ---- atom (nucleus) positions ----
      const R0 = size * 0.36;
      const R1 = size * 0.24;
      const R2 = size * 0.09;
      const ringR = lerp(lerp(R0, R1, kB), R2, kC);
      const spin = time * 0.25;
      const rN = size * 0.05;
      const rL = size * 0.036;

      type Drawn = { x: number; y: number; z: number; r: number; color: string; symbol: string; alpha: number };
      const nuclei: Drawn[] = [];
      const atomPos: { x: number; y: number; r: number; appear: number }[] = [];

      atoms.forEach((a, i) => {
        const appearRaw = clamp01((p - (i / n) * 0.1) / 0.1);
        const appear = easeOutBack(appearRaw);
        const R = lerp(R0 * 1.35, ringR, Math.min(1, appear));
        const ring = { x: cx + Math.cos(a.angle + spin) * R, y: cy + Math.sin(a.angle + spin) * R };

        const kD = smooth(0.75 + i * 0.015, 0.93 + i * 0.015, p);
        const site = sites[i % 9];
        const x = lerp(ring.x, site.x, kD);
        const y = lerp(ring.y, site.y, kD);
        const r = lerp(rN * (1 - 0.15 * kC), rL * site.s, kD) * Math.max(0, appear);
        const alpha = clamp01(appearRaw * 1.5) * (i >= 9 ? 1 - kD : 1);

        atomPos.push({ x, y, r, appear: appearRaw });
        nuclei.push({ x, y, z: site.z * kD, r, color: a.color, symbol: a.symbol, alpha });
      });

      // lattice sites not covered by a selected atom fill in as the solid solution grows
      for (let k = n; k < 9; k++) {
        const t = smooth(0.84 + (k - n) * 0.012, 0.97 + (k - n) * 0.012, p);
        if (t <= 0) continue;
        const src = atoms[k % n];
        const site = sites[k];
        nuclei.push({
          x: site.x,
          y: site.y,
          z: site.z,
          r: rL * site.s * easeOutBack(t),
          color: src.color,
          symbol: src.symbol,
          alpha: t,
        });
      }

      // ---- shared electron sea orbits ----
      const Rs = size * 0.3;
      if (seaA > 0.01) {
        ctx.save();
        ctx.lineWidth = 1;
        for (let q = 0; q < 3; q++) {
          ctx.strokeStyle = rgba(ACCENT, 0.28 * seaA);
          ctx.beginPath();
          ctx.ellipse(cx, cy, Rs, Rs * 0.36, q * (Math.PI / 3), 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      }

      // ---- BCC cell edges + nearest-neighbour bonds ----
      if (latA > 0.01) {
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(NEUTRAL, 0.4 * latA);
        CUBE_EDGES.forEach(([a, b]) => {
          ctx.beginPath();
          ctx.moveTo(sites[a].x, sites[a].y);
          ctx.lineTo(sites[b].x, sites[b].y);
          ctx.stroke();
        });
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = rgba(ACCENT, 0.3 * latA);
        for (let k = 1; k < 9; k++) {
          ctx.beginPath();
          ctx.moveTo(sites[0].x, sites[0].y);
          ctx.lineTo(sites[k].x, sites[k].y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // ---- covalent-style bonds with shared electrons ----
      const bonds: [number, number][] =
        n === 2 ? [[0, 1]] : n > 2 ? atoms.map((_, i) => [i, (i + 1) % n] as [number, number]) : [];
      if (bondA > 0.01) {
        bonds.forEach(([a, b], idx) => {
          const A = atomPos[a];
          const B = atomPos[b];
          ctx.save();
          const g = ctx.createLinearGradient(A.x, A.y, B.x, B.y);
          g.addColorStop(0, rgba(atoms[a].color, 0.7 * bondA));
          g.addColorStop(1, rgba(atoms[b].color, 0.7 * bondA));
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
          ctx.stroke();

          for (const off of [0, 0.5]) {
            let u = (time * 0.9 + idx * 0.37 + off) % 2;
            if (u > 1) u = 2 - u;
            const x = lerp(A.x, B.x, u);
            const y = lerp(A.y, B.y, u);
            ctx.globalAlpha = bondA;
            ctx.shadowColor = ACCENT;
            ctx.shadowBlur = 10;
            ctx.fillStyle = T.electron;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(1.8, size * 0.008), 0, TAU);
            ctx.fill();
          }
          ctx.restore();
        });
      }

      // ---- per-atom orbitals ----
      const orbitFade = 1 - smooth(0.52, 0.7, p);
      atoms.forEach((a, i) => {
        const P = atomPos[i];
        const alpha = P.appear * orbitFade;
        if (alpha <= 0.01) return;
        const rO = rN * 2.2 * (1 + 0.2 * kC);
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(a.color, 0.38 * alpha);
        for (let q = 0; q < 3; q++) {
          ctx.beginPath();
          ctx.ellipse(P.x, P.y, rO, rO * 0.34, a.tilt + q * (Math.PI / 3), 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      });

      // ---- nuclei (depth sorted) ----
      nuclei.sort((u, v) => v.z - u.z).forEach((d) => drawNucleus(d.x, d.y, d.r, d.color, d.symbol, d.alpha));

      // ---- electrons ----
      const eR = Math.max(1.6, size * 0.0075);
      electrons.forEach((e) => {
        const a = atoms[e.atom];
        const P = atomPos[e.atom];
        if (P.appear <= 0.01) return;

        // own orbital
        const rO = rN * 2.2 * (1 + 0.2 * kC);
        const phi = e.phase + time * e.speed;
        const th = a.tilt + e.plane * (Math.PI / 3);
        const lx = rO * Math.cos(phi);
        const ly = rO * 0.34 * Math.sin(phi);
        const ox = P.x + lx * Math.cos(th) - ly * Math.sin(th);
        const oy = P.y + lx * Math.sin(th) + ly * Math.cos(th);

        // shared (merged) orbital
        const psi = e.seaPhase + time * e.seaSpeed;
        const sx = Rs * Math.cos(psi);
        const sy = Rs * 0.36 * Math.sin(psi);
        const seaX = cx + sx * Math.cos(e.seaTilt) - sy * Math.sin(e.seaTilt);
        const seaY = cy + sx * Math.sin(e.seaTilt) + sy * Math.cos(e.seaTilt);

        // free electron gas inside the lattice
        const gx = cx + size * 0.24 * Math.sin(time * e.gas[0] + e.gas[1]);
        const gy = cy + size * 0.22 * Math.sin(time * e.gas[2] + e.gas[3]);

        const m = smooth(0.5 + e.delay, 0.68 + e.delay, p);
        const x = lerp(lerp(ox, seaX, m), gx, gasK);
        const y = lerp(lerp(oy, seaY, m), gy, gasK);

        if (!reduced) {
          e.trail.push({ x, y });
          if (e.trail.length > 8) e.trail.shift();
          e.trail.forEach((t, ti) => {
            const ta = ((ti + 1) / e.trail.length) * 0.35 * P.appear;
            ctx.fillStyle = rgba(ACCENT, ta);
            ctx.beginPath();
            ctx.arc(t.x, t.y, eR * (0.4 + (0.6 * ti) / e.trail.length), 0, TAU);
            ctx.fill();
          });
        }

        ctx.save();
        ctx.globalAlpha = P.appear * (1 - 0.35 * gasK);
        ctx.shadowColor = ACCENT;
        ctx.shadowBlur = 8 * T.glow;
        ctx.fillStyle = T.electron;
        ctx.beginPath();
        ctx.arc(x, y, eR, 0, TAU);
        ctx.fill();
        ctx.restore();
      });

      // ---- completion shockwave ----
      if (burst > 0) {
        ctx.save();
        ctx.strokeStyle = rgba(SUCCESS, 0.7 * burst);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, size * (0.12 + 0.36 * (1 - Math.pow(1 - bt, 3))), 0, TAU);
        ctx.stroke();
        ctx.restore();
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, totalMs, theme]);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0" aria-label="원소 합성 애니메이션" role="img" />
    </div>
  );
}
