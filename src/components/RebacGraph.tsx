import type { Tuple } from '../engines/rebac';

const VIEW_W = 720;
const BOX_W = 180;
const BOX_H = 32;
const ROW_H = 54;
// The middle column sits left of centre: user-to-folder edges are short and straight,
// while the fan-in to the documents needs room to curve.
const COL_X = [0, 222, VIEW_W - BOX_W];
/** Approximate advance of one character of the 11.5px monospace label face. */
const CHAR_W = 6.9;
const LINE_H = 13;

const key = (t: Tuple) => `${t.user}|${t.relation}|${t.object}`;

/**
 * Users on the left, documents on the right, and everything a path passes through in
 * the middle: folders, and the wildcard user that carries a condition.
 */
function columnOf(ref: string): 0 | 1 | 2 {
  if (ref === 'user:*' || ref.startsWith('folder:')) return 1;
  return ref.startsWith('user:') ? 0 : 2;
}

interface Props {
  tuples: Tuple[];
  path: Tuple[];
  label: string;
  /** For a conditional tuple: whether its condition holds for the request, and a caption. */
  conditionState?: (t: Tuple) => { holds: boolean; caption: string } | undefined;
}

/** A point on the cubic from (x1,y1) to (x2,y2) with horizontal tangents at both ends. */
function along(x1: number, y1: number, x2: number, y2: number, t: number) {
  const mx = (x1 + x2) / 2;
  const u = 1 - t;
  return {
    x: u * u * u * x1 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x2,
    y: u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2,
  };
}

/**
 * Draws the relationship tuples as a graph and highlights only the path that made the
 * decision hold, showing Zanzibar's "permission is reachability" idea directly.
 *
 * The middle column starts below the last document row. Direct user-to-document edges
 * then cross an empty band instead of running through a folder box, which is what
 * every earlier layout of this diagram got wrong in one way or another.
 */
export function RebacGraph({ tuples, path, label, conditionState }: Props) {
  const hit = new Set(path.map(key));

  const cols: string[][] = [[], [], []];
  for (const t of tuples) {
    for (const ref of [t.user, t.object]) {
      const c = columnOf(ref);
      if (!cols[c].includes(ref)) cols[c].push(ref);
    }
  }
  // The wildcard is not a place in the hierarchy, so it sits under the folders.
  cols[1].sort((a, b) => Number(a === 'user:*') - Number(b === 'user:*'));

  const middleStart = cols[2].length;
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((refs, c) =>
    refs.forEach((ref, i) =>
      pos.set(ref, { x: COL_X[c], y: (c === 1 ? middleStart + i : i) * ROW_H }),
    ),
  );
  const rows = Math.max(cols[0].length, cols[2].length, middleStart + cols[1].length);

  // A conditional tuple's condition is the same for every edge out of its node, so it
  // is written once under the node rather than repeated on each edge.
  const gate = new Map<string, { name: string; holds: boolean; caption: string }>();
  for (const t of tuples) {
    const c = t.condition ? conditionState?.(t) : undefined;
    if (c && !gate.has(t.user)) gate.set(t.user, { name: t.condition!, ...c });
  }

  type Edge = { t: Tuple; d: string; lx: number; ly: number; state: 'hit' | 'veto' | 'idle' };
  const edges: Edge[] = [];
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  // Node boxes and their captions count as occupied, so no label is set on top of one.
  for (const [ref, p] of pos) {
    placed.push({ x0: p.x, x1: p.x + BOX_W, y0: p.y, y1: p.y + BOX_H + (gate.has(ref) ? 16 : 0) });
  }

  for (const t of tuples) {
    const a = pos.get(t.user);
    const b = pos.get(t.object);
    if (!a || !b) continue;
    const x1 = a.x + BOX_W;
    const y1 = a.y + BOX_H / 2;
    const x2 = b.x;
    const y2 = b.y + BOX_H / 2;
    const mx = (x1 + x2) / 2;
    const g = gate.get(t.user);

    // Walk along the curve from its middle until the label lands somewhere free, then
    // nudge it down a line at a time if it still collides.
    const w = t.relation.length * CHAR_W + 8;
    const free = (x: number, y: number) =>
      !placed.some(
        (r) => x - w / 2 < r.x1 && x + w / 2 > r.x0 && y - LINE_H + 2 < r.y1 && y + 2 > r.y0,
      );
    let spot = along(x1, y1, x2, y2, 0.5);
    for (const tt of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const p = along(x1, y1, x2, y2, tt);
      if (free(p.x, p.y - 4)) {
        spot = p;
        break;
      }
    }
    let ly = spot.y - 4;
    for (let guard = 0; guard < 6 && !free(spot.x, ly); guard++) ly += LINE_H;
    placed.push({ x0: spot.x - w / 2, x1: spot.x + w / 2, y0: ly - LINE_H + 2, y1: ly + 2 });

    edges.push({
      t,
      d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`,
      lx: spot.x,
      ly,
      state: hit.has(key(t)) ? 'hit' : g && !g.holds ? 'veto' : 'idle',
    });
  }

  const bottom = Math.max(rows * ROW_H, ...placed.map((r) => r.y1)) + 8;
  const top = Math.min(-4, ...placed.map((r) => r.y0 - 4));

  return (
    <svg
      className="rgraph"
      viewBox={`0 ${top} ${VIEW_W} ${bottom - top}`}
      role="img"
      aria-label={label}
    >
      {/* Paths first, then every label, so no curve is drawn over a label. */}
      {edges.map((e) => (
        <path key={key(e.t)} className={`r-edge ${e.state}`} d={e.d} />
      ))}
      {edges.map((e) => (
        <text key={key(e.t)} className={`r-label ${e.state}`} x={e.lx} y={e.ly} textAnchor="middle">
          {e.t.relation}
        </text>
      ))}
      {[...pos.entries()].map(([ref, p]) => {
        const on = path.some((t) => t.user === ref || t.object === ref);
        const g = gate.get(ref);
        return (
          <g key={ref} className={`r-node${on ? ' hit' : ''}${g && !g.holds ? ' veto' : ''}`}>
            <rect x={p.x} y={p.y} width={BOX_W} height={BOX_H} />
            <text x={p.x + 10} y={p.y + 20.5}>
              {ref}
            </text>
            {g && (
              <text className="r-cond" x={p.x} y={p.y + BOX_H + 14}>
                {g.name}: {g.caption}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
