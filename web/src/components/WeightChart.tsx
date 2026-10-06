import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { MetricPoint } from '../api/types';
import {
  chartSummary,
  formatCm,
  formatKg,
  linePath,
  nearestIndex,
  scaleLinear,
  shortMonthDay,
  xTicks,
  yScale,
} from '../lib/chart';
import { daysBetween, formatShortDate } from '../lib/dates';

interface Props {
  name: string;
  points: MetricPoint[]; // ascending by date
  startDate: string;
  endDate: string; // server today
}

const PLOT_H = 190;
const M = { top: 14, right: 46, bottom: 26, left: 44 }; // right leaves room for the end-of-line value

/**
 * One person's weight trend: raw weights as small dots, the 7-day average as the line.
 * Hand-rolled SVG, measured with ResizeObserver so it fills the card at any width.
 * Hover/focus shows a crosshair + tooltip for the nearest day; a table twin sits below.
 */
export function WeightChart({ name, points, startDate, endDate }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  const weighed = points.filter((p): p is MetricPoint & { weightKg: number } => p.weightKg !== null);
  const summary = chartSummary(name, points);

  if (weighed.length === 0) {
    return (
      <div ref={wrapRef} className="chart-wrap">
        <p className="muted chart-empty">No entries yet.</p>
      </div>
    );
  }

  const lastPoint = weighed[weighed.length - 1];
  const domainEnd = lastPoint && lastPoint.date > endDate ? lastPoint.date : endDate;
  const spanDays = Math.max(1, daysBetween(startDate, domainEnd));
  const values = weighed.flatMap((p) => (p.weightAvg7 === null ? [p.weightKg] : [p.weightKg, p.weightAvg7]));
  const ys = yScale(values, { maxTicks: 4, minSpan: 2 });
  const innerW = Math.max(0, width - M.left - M.right);
  const height = PLOT_H + M.top + M.bottom;

  if (!ys || width === 0) {
    return <div ref={wrapRef} className="chart-wrap" style={{ minHeight: height }} />;
  }

  const x = scaleLinear(0, spanDays, M.left, M.left + innerW);
  const y = scaleLinear(ys.min, ys.max, M.top + PLOT_H, M.top);
  const xOf = (date: string) => x(daysBetween(startDate, date));

  const dots = weighed.map((p) => ({ x: xOf(p.date), y: y(p.weightKg), p }));
  const avgPts = weighed
    .filter((p): p is typeof p & { weightAvg7: number } => p.weightAvg7 !== null)
    .map((p) => ({ x: xOf(p.date), y: y(p.weightAvg7) }));
  const avgEnd = avgPts[avgPts.length - 1];
  const lastAvg = lastPoint?.weightAvg7 ?? null;
  const ticks = xTicks(startDate, domainEnd, innerW < 260 ? 3 : 4);
  const xs = dots.map((d) => d.x);

  function pick(clientX: number) {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const i = nearestIndex(xs, clientX - rect.left);
    setActive(i < 0 ? null : i);
  }
  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    pick(e.clientX);
  }
  function onKeyDown(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = e.key === 'ArrowLeft' ? -1 : 1;
      setActive((a) => {
        const base = a ?? dots.length - 1;
        return Math.min(dots.length - 1, Math.max(0, base + delta));
      });
    } else if (e.key === 'Escape') {
      setActive(null);
    }
  }

  const act = active === null ? null : (dots[active] ?? null);
  // Tooltip placement: flip to the left when near the right edge.
  const tipLeft = act ? (act.x > width * 0.6 ? undefined : act.x + 10) : undefined;
  const tipRight = act && act.x > width * 0.6 ? width - act.x + 10 : undefined;

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg
        className="chart"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={summary}
        tabIndex={0}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? dots.length - 1)}
        onBlur={() => setActive(null)}
      >
        {/* gridlines + y labels */}
        {ys.ticks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={M.left} x2={M.left + innerW} y1={y(t)} y2={y(t)} />
            <text className="chart-tick" x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        ))}
        {/* x labels */}
        {ticks.map((t, i) => {
          const px = xOf(t.date);
          const anchor = i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle';
          return (
            <text key={t.date} className="chart-tick" x={px} y={height - 6} textAnchor={anchor}>
              {t.label}
            </text>
          );
        })}
        {/* crosshair */}
        {act && <line className="chart-crosshair" x1={act.x} x2={act.x} y1={M.top} y2={M.top + PLOT_H} />}
        {/* raw weights: small dots with a surface ring */}
        {dots.map((d, i) => (
          <circle key={d.p.date} className="chart-dot" data-active={i === active} cx={d.x} cy={d.y} r={3.5} />
        ))}
        {/* 7-day average line */}
        {avgPts.length > 1 && <path className="chart-line" d={linePath(avgPts)} />}
        {avgEnd && lastAvg !== null && (
          <>
            <circle className="chart-end" cx={avgEnd.x} cy={avgEnd.y} r={4.5} />
            <text className="chart-end-label" x={avgEnd.x + 9} y={avgEnd.y} dominantBaseline="middle" textAnchor="start">
              {lastAvg.toFixed(1)}
            </text>
          </>
        )}
      </svg>
      {act && (
        <div
          className="chart-tip"
          aria-hidden="true"
          style={{
            ...(tipLeft !== undefined ? { left: tipLeft } : {}),
            ...(tipRight !== undefined ? { right: tipRight } : {}),
            top: Math.max(0, act.y - 12),
          }}
        >
          <div className="chart-tip-date">{formatShortDate(act.p.date)}</div>
          <div className="chart-tip-row">
            <span className="chart-tip-key chart-tip-key-dot" />
            <strong>{formatKg(act.p.weightKg)}</strong>
            <span className="muted">weight</span>
          </div>
          {act.p.weightAvg7 !== null && (
            <div className="chart-tip-row">
              <span className="chart-tip-key chart-tip-key-line" />
              <strong>{formatKg(act.p.weightAvg7)}</strong>
              <span className="muted">7-day avg</span>
            </div>
          )}
          {act.p.waistCm !== null && (
            <div className="chart-tip-row">
              <span className="chart-tip-key" />
              <strong>{formatCm(act.p.waistCm)}</strong>
              <span className="muted">waist</span>
            </div>
          )}
        </div>
      )}
      <div className="chart-legend" aria-hidden="true">
        <span>
          <span className="chart-tip-key chart-tip-key-dot" /> daily
        </span>
        <span>
          <span className="chart-tip-key chart-tip-key-line" /> 7-day average
        </span>
      </div>
      <details className="chart-table">
        <summary>Show as table</summary>
        <table id={tableId}>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Weight</th>
              <th scope="col">7-day avg</th>
              <th scope="col">Waist</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.date}>
                <th scope="row">{shortMonthDay(p.date)}</th>
                <td>{formatKg(p.weightKg)}</td>
                <td>{formatKg(p.weightAvg7)}</td>
                <td>{formatCm(p.waistCm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
