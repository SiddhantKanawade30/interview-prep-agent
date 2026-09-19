import { useEffect, useLayoutEffect, useRef, useState } from "react";

import "./LatticeLoader.css";

const PATTERNS = {
  orbit: {
    3: { cells: [0, 1, 2, 7, null, 3, 6, 5, 4], loop: 8, scale: 1.2 },
    4: { cells: [0, 1, 2, 3, 11, null, null, 4, 10, null, null, 5, 9, 8, 7, 6], loop: 6, scale: 1.2, lit: 0.45 },
  },
  sweep: { 4: { cells: [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6], loop: 5, scale: 1, lit: 0.45 } },
};

const DEFAULT_PATTERN = { 3: "orbit", 4: "sweep" } as const;
const MARKS = {
  3: { done: [2, 3, 5, 7], error: [0, 2, 4, 6, 8] },
  4: { done: [7, 8, 10, 13], error: [0, 3, 5, 6, 9, 10, 12, 15] },
};

type Pattern = { cells: Array<number | null>; loop: number; scale: number; lit?: number };

function resolvePattern(pattern: string | Pattern, grid: 3 | 4): Pattern {
  if (typeof pattern === "string") {
    const named = PATTERNS[pattern as keyof typeof PATTERNS];
    return (named && named[grid]) || PATTERNS[DEFAULT_PATTERN[grid]][grid];
  }

  const cells = Array.from({ length: grid * grid }, (_, index) => pattern.cells[index] ?? null);
  const max = Math.max(0, ...cells.filter((value): value is number => value != null));
  return { cells, loop: pattern.loop ?? max + 4.2, scale: pattern.scale ?? 1, lit: pattern.lit ?? 0.62 };
}

function formatElapsed(deciseconds: number) {
  return deciseconds < 600
    ? `${(deciseconds / 10).toFixed(1)}s`
    : `${Math.floor(deciseconds / 600)}m ${((deciseconds % 600) / 10).toFixed(1)}s`;
}

function spokenElapsed(deciseconds: number) {
  return deciseconds < 600
    ? `${(deciseconds / 10).toFixed(1)} seconds`
    : `${Math.floor(deciseconds / 600)} minutes ${((deciseconds % 600) / 10).toFixed(1)} seconds`;
}

export interface LatticeLoaderProps {
  label?: string;
  doneLabel?: string;
  errorLabel?: string;
  status?: "working" | "done" | "error";
  pattern?: string | Pattern;
  grid?: 3 | 4;
  shape?: "square" | "round";
  color?: string;
  doneColor?: string;
  errorColor?: string;
  cellSize?: number;
  gap?: number;
  fontSize?: number;
  step?: number;
  idleOpacity?: number;
  glow?: boolean;
  glowColor?: string;
  showTimer?: boolean;
  elapsed?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function LatticeLoader({
  label = "Thinking",
  doneLabel = "Done in",
  errorLabel = "Failed after",
  status = "working",
  pattern = "orbit",
  grid = 3,
  shape = "round",
  color = "currentColor",
  doneColor = "#22c55e",
  errorColor = "#ef4444",
  cellSize = 6,
  gap = 2,
  fontSize = 14,
  step = 90,
  idleOpacity = 0.15,
  glow = false,
  glowColor = "",
  showTimer = true,
  elapsed,
  className = "",
  style,
}: LatticeLoaderProps) {
  const n = grid === 4 ? 4 : 3;
  const resolvedPattern = resolvePattern(pattern, n);
  const mark = status === "working" ? "done" : status;
  const duration = step * resolvedPattern.scale;
  const cycle = Math.round(resolvedPattern.loop * duration);
  const timerRef = useRef<HTMLSpanElement>(null);
  const elapsedRef = useRef(0);
  const markRef = useRef<"done" | "error">("done");
  const [announce, setAnnounce] = useState(`${label}, in progress`);

  const paint = (value: number) => {
    elapsedRef.current = value;
    if (timerRef.current) timerRef.current.textContent = formatElapsed(value);
  };

  useLayoutEffect(() => {
    if (elapsed != null) {
      paint(Math.round(elapsed * 10));
      return;
    }
    if (status !== "working") return;
    const startedAt = performance.now();
    paint(0);
    const intervalId = window.setInterval(() => paint(Math.floor((performance.now() - startedAt) / 100)), 100);
    return () => window.clearInterval(intervalId);
  }, [elapsed, status]);

  useEffect(() => {
    if (status === "working") {
      setAnnounce(`${label}, in progress`);
    } else {
      setAnnounce(`${status === "done" ? doneLabel : errorLabel}${showTimer ? ` ${spokenElapsed(elapsedRef.current)}` : ""}`);
    }
  }, [doneLabel, errorLabel, label, showTimer, status]);

  markRef.current = mark;

  return (
    <span
      role="status"
      className={`lattice-loader${className ? ` ${className}` : ""}`}
      data-status={status}
      data-shape={shape}
      data-glow={glow ? "" : undefined}
      style={{
        "--ll-n": n,
        "--ll-cell": `${cellSize}px`,
        "--ll-gap": `${gap}px`,
        "--ll-font": `${fontSize}px`,
        "--ll-color": color,
        "--ll-mark": status === "error" ? errorColor : doneColor,
        "--ll-idle": idleOpacity,
        "--ll-glow": glowColor || color,
        "--ll-mark-glow": glowColor || (status === "error" ? errorColor : doneColor),
        "--ll-cycle": `${cycle}ms`,
        ...style,
      } as React.CSSProperties}
    >
      <span className="lattice-loader__grid" aria-hidden="true">
        <span className="lattice-loader__layer lattice-loader__run">
          {resolvedPattern.cells.map((unit, index) => (
            <span
              key={index}
              className="lattice-loader__cell"
              data-hole={unit == null ? "" : undefined}
              data-lit={resolvedPattern.lit && resolvedPattern.lit !== 0.62 ? Math.round(resolvedPattern.lit * 100) : undefined}
              style={unit == null ? undefined : { animationDelay: `${Math.round(unit * duration)}ms` }}
            />
          ))}
        </span>
        <span className="lattice-loader__layer lattice-loader__mark">
          {resolvedPattern.cells.map((_, index) => (
            <span key={index} className="lattice-loader__cell" data-on={MARKS[n][markRef.current].includes(index) ? "" : undefined} />
          ))}
        </span>
      </span>
      <span className="lattice-loader__label" aria-hidden="true">
        <span className="lattice-loader__text" data-active={status === "working" ? "" : undefined}>{label}</span>
        <span className="lattice-loader__text" data-active={status === "done" ? "" : undefined}>{doneLabel}</span>
        <span className="lattice-loader__text" data-active={status === "error" ? "" : undefined}>{errorLabel}</span>
      </span>
      {showTimer ? <span ref={timerRef} className="lattice-loader__timer" aria-hidden="true">0.0s</span> : null}
      <span className="lattice-loader__sr">{announce}</span>
    </span>
  );
}