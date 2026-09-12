import type { Tuple } from '../engines/rebac';

const COL_X = { user: 16, folder: 232, document: 448 } as const;
const BOX_W = 156;
const BOX_H = 34;
const ROW_H = 58;

type NodeType = keyof typeof COL_X;

function typeOf(ref: string): NodeType {
  const t = ref.split(':')[0];
  return t === 'user' || t === 'folder' || t === 'document' ? t : 'document';
}

const key = (t: Tuple) => `${t.user}|${t.relation}|${t.object}`;

/**
 * Draws the relationship tuples as a graph and highlights only the path that made
 * the decision hold, showing Zanzibar's "permission is reachability" idea directly.
 */
export function RebacGraph({
  tuples,
  path,
  label,
}: {
  tuples: Tuple[];
  path: Tuple[];
  label: string;
}) {
  const hit = new Set(path.map(key));

  const byCol: Record<NodeType, string[]> = { user: [], folder: [], document: [] };
  for (const t of tuples) {
    for (const ref of [t.user, t.object]) {
      const col = typeOf(ref);
      if (!byCol[col].includes(ref)) byCol[col].push(ref);
    }
  }

  const pos = new Map<string, { x: number; y: number }>();
  for (const col of Object.keys(byCol) as NodeType[]) {
    byCol[col].forEach((ref, i) => {
      pos.set(ref, { x: COL_X[col], y: 20 + i * ROW_H });
    });
  }

  const rows = Math.max(1, ...Object.values(byCol).map((c) => c.length));
  const height = 20 + rows * ROW_H;
  // Room above the boxes for edges that have to hop a column, and how far clear of a
  // box the curve itself must actually pass.
  const HEADROOM = 44;
  const ARC_CLEARANCE = 10;

  return (
    <svg viewBox={`0 ${-HEADROOM} 620 ${height + HEADROOM}`} role="img" aria-label={label}>
      {tuples.map((t) => {
        const a = pos.get(t.user);
        const b = pos.get(t.object);
        if (!a || !b) return null;
        const on = hit.has(key(t));
        const x1 = a.x + BOX_W;
        const y1 = a.y + BOX_H / 2;
        const x2 = b.x;
        const y2 = b.y + BOX_H / 2;
        const mx = (x1 + x2) / 2;

        // An edge spanning more than one column runs straight through whatever sits
        // between, so the owner edge appeared to pass through the folder and the diagram
        // contradicted the trace printed beneath it.
        //
        // Arcing over it is not as simple as lifting the control points: a cubic never
        // reaches them. For a symmetric curve the highest point is at t=0.5 and equals
        // (y1 + 3·cy + 3·cy + y2) / 8, so placing the control points just above the box
        // still left the curve clipping its corners. Solve for the control height that
        // puts the curve itself the wanted distance clear instead.
        const spansAColumn = x2 - x1 > BOX_W;
        const peak = Math.min(y1, y2) - BOX_H / 2 - ARC_CLEARANCE;
        const apexY = (8 * peak - y1 - y2) / 6;
        const d = spansAColumn
          ? `M${x1},${y1} C${x1 + 60},${apexY} ${x2 - 60},${apexY} ${x2},${y2}`
          : `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
        // Two edges into the same object share a midpoint, so their labels landed on top
        // of each other. Stagger by how many arcs already end there.
        const siblings = tuples.filter(
          (o) => o.object === t.object && pos.has(o.user) && pos.get(o.user)!.x + BOX_W < b.x,
        );
        const rank = siblings.findIndex((o) => key(o) === key(t));
        const labelY = spansAColumn ? peak - 4 - Math.max(0, rank) * 12 : (y1 + y2) / 2 - 5;

        return (
          <g key={key(t)}>
            <path className={`edge${on ? ' hit' : ''}`} d={d} />
            <text className={`edge-t${on ? ' hit' : ''}`} x={mx} y={labelY} textAnchor="middle">
              {t.relation}
            </text>
          </g>
        );
      })}

      {[...pos.entries()].map(([ref, p]) => {
        const on = path.some((t) => t.user === ref || t.object === ref);
        return (
          <g key={ref}>
            <rect
              className={`node-box${on ? ' hit' : ''}`}
              x={p.x}
              y={p.y}
              width={BOX_W}
              height={BOX_H}
            />
            <text className={`node-t${on ? '' : ' dim'}`} x={p.x + 10} y={p.y + 22}>
              {ref}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
