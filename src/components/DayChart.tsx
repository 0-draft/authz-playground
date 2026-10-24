import { useRef } from 'react';
import type { EngineMeta, EngineResult } from '../core/engine';
import { UI, fill, type Lang } from '../i18n';
import { CLOSES, DAY_HOURS, OPENS, hh, inHours, minorityAt, splitHours } from '../core/day';

/** Vertical size of one engine's lane, in CSS pixels. The SVG is drawn in these units. */
const LANE = 44;
/** Horizontal size of one hour in viewBox units. Stretched to the real width. */
const HOUR = 10;
const WIDTH = HOUR * 24;
/** Inset of the high and low levels from the lane edges. */
const PAD = 11;

/** The step trace of one day: high where allowed, low where denied. */
function tracePath(day: EngineResult[], top: number): string {
  const hi = top + PAD;
  const lo = top + LANE - PAD;
  let d = '';
  day.forEach((r, h) => {
    const y = r.decision === 'allow' ? hi : lo;
    d += h === 0 ? `M0,${y}` : `L${h * HOUR},${y}`;
    d += `L${(h + 1) * HOUR},${y}`;
  });
  return d;
}

interface Props {
  lang: Lang;
  engines: EngineMeta[];
  /** engine id -> one result per hour, or undefined while still evaluating */
  results: Record<string, EngineResult[] | undefined>;
  hour: number;
  onHour(hour: number): void;
  /** Whether a rule in force reads the clock. Before R3 the band would mean nothing. */
  showHours: boolean;
}

/**
 * A timing diagram of every engine's answer across the day, for one question.
 *
 * Laid out as a datasheet timing chart rather than a row of cards because the thing
 * being shown is a signal over time: where the window opens and closes, and the one
 * lane that never drops.
 */
export function DayChart({ lang, engines, results, hour, onHour, showHours }: Props) {
  const t = (l: { en: string; ja: string }) => l[lang];
  const plot = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const split = splitHours(results);
  const height = engines.length * LANE;

  const hourAt = (clientX: number) => {
    const box = plot.current!.getBoundingClientRect();
    const h = Math.floor(((clientX - box.left) / box.width) * 24);
    return Math.max(0, Math.min(23, h));
  };

  const valueText = `${hh(hour)}, ${t(inHours(hour) ? UI.withinHours : UI.outsideHours)}`;

  return (
    <div className="day" style={{ ['--lanes' as string]: engines.length }}>
      <div className="day-names" aria-hidden="true">
        {engines.map((e) => (
          <div className="day-name" key={e.id}>
            {e.name}
            <small>{e.year}</small>
          </div>
        ))}
      </div>

      <div
        className="day-plot"
        ref={plot}
        role="slider"
        tabIndex={0}
        aria-label={t(UI.hourLabel)}
        aria-valuemin={0}
        aria-valuemax={23}
        aria-valuenow={hour}
        aria-valuetext={valueText}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onHour(hourAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (dragging.current) {
            const h = hourAt(e.clientX);
            if (h !== hour) onHour(h);
          }
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={(e) => {
          const step: Record<string, number> = {
            ArrowRight: 1,
            ArrowUp: 1,
            ArrowLeft: -1,
            ArrowDown: -1,
            PageUp: 3,
            PageDown: -3,
          };
          let next: number | null = null;
          if (e.key in step) next = Math.max(0, Math.min(23, hour + step[e.key]));
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = 23;
          if (next !== null) {
            e.preventDefault();
            onHour(next);
          }
        }}
      >
        <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {showHours && (
            <rect
              className="day-band"
              x={OPENS * HOUR}
              y={0}
              width={(CLOSES - OPENS) * HOUR}
              height={height}
            />
          )}
          {[...split].map((h) => (
            <rect key={h} className="day-split" x={h * HOUR} y={0} width={HOUR} height={height} />
          ))}
          {DAY_HOURS.slice(1).map((h) => (
            <line
              key={h}
              className={h % 6 === 0 ? 'day-grid major' : 'day-grid'}
              x1={h * HOUR}
              x2={h * HOUR}
              y1={0}
              y2={height}
            />
          ))}
          {engines.map((e, i) => (
            <line
              key={e.id}
              className="day-lane"
              x1={0}
              x2={WIDTH}
              y1={(i + 1) * LANE}
              y2={(i + 1) * LANE}
            />
          ))}
          {engines.map((e, i) => {
            const day = results[e.id];
            // A failed engine has no trace to draw; its verdict column says so.
            if (!day || day.some((r) => r.error)) return null;
            const top = i * LANE;
            return (
              <g key={e.id}>
                {day.map((r, h) =>
                  r.decision === 'allow' ? (
                    <rect
                      key={h}
                      className="day-high"
                      x={h * HOUR}
                      y={top + PAD}
                      width={HOUR}
                      height={LANE - 2 * PAD}
                    />
                  ) : null,
                )}
                <path className="day-trace" d={tracePath(day, top)} />
                {/* The lane in the minority is redrawn in red over the hours it dissents. */}
                {day.map((r, h) =>
                  split.has(h) && minorityAt(results, h).has(e.id) ? (
                    <line
                      key={h}
                      className="day-dissent"
                      x1={h * HOUR}
                      x2={(h + 1) * HOUR}
                      y1={top + (r.decision === 'allow' ? PAD : LANE - PAD)}
                      y2={top + (r.decision === 'allow' ? PAD : LANE - PAD)}
                    />
                  ) : null,
                )}
              </g>
            );
          })}
          <rect className="day-cursor" x={hour * HOUR} y={0} width={HOUR} height={height} />
        </svg>
        <div className="day-axis" aria-hidden="true">
          {DAY_HOURS.map((h) => (
            <span
              key={h}
              style={{ left: `${((h + 0.5) / 24) * 100}%` }}
              data-edge={showHours && (h === OPENS || h === CLOSES)}
              data-on={h === hour}
              data-near={h !== hour && Math.abs(h - hour) <= 2}
              data-split={split.has(h)}
            >
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>
        {showHours && (
          <div
            className="day-band-label"
            aria-hidden="true"
            style={{ left: `${(OPENS / 24) * 100}%`, width: `${((CLOSES - OPENS) / 24) * 100}%` }}
          >
            {t(UI.businessHours)}
          </div>
        )}
      </div>

      <div className="day-verdicts">
        {engines.map((e) => {
          const r = results[e.id]?.[hour];
          const odd = split.has(hour) && minorityAt(results, hour).has(e.id);
          return (
            <div className="day-verdict" key={e.id} data-d={r?.decision} data-odd={odd}>
              <span className="sr-only">{e.name}: </span>
              {r
                ? r.error
                  ? t(UI.failedWord)
                  : t(r.decision === 'allow' ? UI.allowWord : UI.denyWord)
                : '…'}
            </div>
          );
        })}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {hh(hour)}:{' '}
        {engines
          .map((e) => {
            const r = results[e.id]?.[hour];
            return fill(
              t(UI.verdictSummary),
              e.name,
              r
                ? r.error
                  ? t(UI.failedWord)
                  : t(r.decision === 'allow' ? UI.allowWord : UI.denyWord)
                : t(UI.evaluating),
            );
          })
          .join(', ')}
      </p>
    </div>
  );
}
