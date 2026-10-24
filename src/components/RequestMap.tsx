import { useRef, useState } from 'react';
import type { EngineMeta } from '../core/engine';
import type { MapOutcome } from '../core/outcome';
import type { AccessRequest } from '../core/scenario';
import { ACTIONS, formatRequest } from '../core/scenario';
import { UI, fill, type Lang } from '../i18n';

interface Props {
  lang: Lang;
  engines: EngineMeta[];
  requests: readonly AccessRequest[];
  outcome: MapOutcome | null;
  selected: number;
  onSelect(index: number): void;
}

/**
 * Every request the stage can produce, one table per subject.
 *
 * The requests are laid out on their real axes (action, then resource, then hour)
 * rather than as one anonymous strip, so a square can be read without hovering it.
 */
export function RequestMap({ lang, engines, requests, outcome, selected, onSelect }: Props) {
  const t = (l: { en: string; ja: string }) => l[lang];
  const subjects = [...new Set(requests.map((r) => r.subject))];
  const resources = [...new Set(requests.map((r) => r.resource))];
  const hours = [...new Set(requests.map((r) => r.context.hour))];
  const [hover, setHover] = useState<number | null>(null);

  // The question above can be at any hour, and most hours are not columns here, so the
  // selection is often -1. Reading requests[-1] took the whole page down.
  const read = (i: number | null) => {
    if (i === null || i < 0) return null;
    const r = requests[i];
    return (
      <>
        <code>{formatRequest(r)}</code>
        <span className="readout-votes">
          {engines.map((e) => {
            const d = outcome?.decisions[e.id]?.[i];
            const odd = outcome?.minority[i]?.includes(e.id);
            return (
              <span key={e.id} data-d={d} data-odd={odd}>
                {e.name} {d ? t(d === 'allow' ? UI.allowWord : UI.denyWord) : '…'}
              </span>
            );
          })}
        </span>
      </>
    );
  };

  return (
    <div className="rmap">
      {subjects.map((subject) => (
        <SubjectTable
          key={subject}
          lang={lang}
          subject={subject}
          engines={engines}
          requests={requests}
          resources={resources}
          hours={hours}
          outcome={outcome}
          selected={selected}
          hover={hover}
          onHover={setHover}
          onSelect={onSelect}
        />
      ))}
      <p className="rmap-readout" aria-hidden="true">
        {read(hover ?? selected)}
      </p>
    </div>
  );
}

function SubjectTable({
  lang,
  subject,
  engines,
  requests,
  resources,
  hours,
  outcome,
  selected,
  hover,
  onHover,
  onSelect,
}: {
  lang: Lang;
  subject: string;
  engines: EngineMeta[];
  requests: readonly AccessRequest[];
  resources: string[];
  hours: number[];
  outcome: MapOutcome | null;
  selected: number;
  hover: number | null;
  onHover(i: number | null): void;
  onSelect(i: number): void;
}) {
  const t = (l: { en: string; ja: string }) => l[lang];
  const table = useRef<HTMLTableElement>(null);

  // Columns in display order, each pointing back at its index in `requests`.
  const cols: number[] = [];
  for (const action of ACTIONS)
    for (const resource of resources)
      for (const hour of hours) {
        const i = requests.findIndex(
          (r) =>
            r.subject === subject &&
            r.action === action &&
            r.resource === resource &&
            r.context.hour === hour,
        );
        if (i !== -1) cols.push(i);
      }

  // One cell in the tab order per table; the arrow keys move within it. Held as
  // (engine, column) so the cursor survives the engine list growing when Rego loads.
  const [cursor, setCursor] = useState<{ engineId: string; col: number }>({
    engineId: engines[0]?.id ?? '',
    col: 0,
  });
  const cursorRow = Math.max(
    0,
    engines.findIndex((e) => e.id === cursor.engineId),
  );

  const move = (row: number, col: number) => {
    const engineId = engines[row].id;
    setCursor({ engineId, col });
    table.current
      ?.querySelector<HTMLButtonElement>(`button[data-engine="${engineId}"][data-col="${col}"]`)
      ?.focus();
  };

  const perAction = resources.length * hours.length;

  return (
    <div className="rmap-panel">
      <h3>{fill(t(UI.mapSubject), subject)}</h3>
      <div className="rmap-scroll">
        <table
          ref={table}
          role="grid"
          aria-label={fill(t(UI.mapSubject), subject)}
          // Selecting a request selects its whole column, one cell per engine.
          aria-multiselectable="true"
          onKeyDown={(e) => {
            const last = cols.length - 1;
            const keys: Record<string, () => void> = {
              ArrowRight: () => move(cursorRow, Math.min(last, cursor.col + 1)),
              ArrowLeft: () => move(cursorRow, Math.max(0, cursor.col - 1)),
              ArrowDown: () => move(Math.min(engines.length - 1, cursorRow + 1), cursor.col),
              ArrowUp: () => move(Math.max(0, cursorRow - 1), cursor.col),
              Home: () => move(cursorRow, 0),
              End: () => move(cursorRow, last),
            };
            if (keys[e.key]) {
              e.preventDefault();
              keys[e.key]();
            }
          }}
          onMouseLeave={() => onHover(null)}
        >
          <thead>
            <tr>
              <td />
              {ACTIONS.map((a) => (
                <th key={a} scope="colgroup" colSpan={perAction} className="g-action">
                  {a}
                </th>
              ))}
            </tr>
            <tr>
              <td />
              {ACTIONS.map((a) =>
                resources.map((res) => (
                  <th key={`${a}-${res}`} scope="colgroup" colSpan={hours.length} className="g-res">
                    {res}
                  </th>
                )),
              )}
            </tr>
            <tr>
              <td />
              {cols.map((i, c) => (
                <th
                  key={i}
                  scope="col"
                  className="g-hour"
                  data-split={outcome?.clash[i] ?? false}
                  data-hover={hover === i}
                  data-gap={c > 0 && c % hours.length === 0}
                >
                  {String(requests[i].context.hour).padStart(2, '0')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {engines.map((e) => (
              <tr key={e.id}>
                <th scope="row">{e.name}</th>
                {cols.map((i, c) => {
                  const d = outcome?.decisions[e.id]?.[i];
                  const clash = outcome?.clash[i] ?? false;
                  const odd = outcome?.minority[i]?.includes(e.id) ?? false;
                  const label = [
                    e.name,
                    formatRequest(requests[i]),
                    d ? t(d === 'allow' ? UI.keyAllow : UI.keyDeny) : t(UI.evaluating),
                    clash ? t(UI.keyClash) : '',
                  ]
                    .filter(Boolean)
                    .join(', ');
                  return (
                    <td
                      key={i}
                      role="gridcell"
                      aria-selected={i === selected}
                      data-gap={c > 0 && c % hours.length === 0}
                      data-split={clash}
                      data-hover={hover === i}
                      data-sel={i === selected}
                    >
                      <button
                        type="button"
                        data-engine={e.id}
                        data-col={c}
                        data-d={d}
                        data-odd={odd}
                        tabIndex={e.id === engines[cursorRow]?.id && c === cursor.col ? 0 : -1}
                        aria-label={label}
                        onFocus={() => {
                          setCursor({ engineId: e.id, col: c });
                          onHover(i);
                        }}
                        onMouseEnter={() => onHover(i)}
                        onClick={() => onSelect(i)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MapKey({ lang }: { lang: Lang }) {
  const t = (l: { en: string; ja: string }) => l[lang];
  return (
    <ul className="rmap-key">
      {(
        [
          ['allow', UI.keyAllow],
          ['deny', UI.keyDeny],
          ['split', UI.keyClash],
          ['odd', UI.keyOutlier],
          ['sel', UI.keySelected],
        ] as const
      ).map(([k, label]) => (
        <li key={k} data-k={k}>
          <i aria-hidden="true" />
          {t(label)}
        </li>
      ))}
    </ul>
  );
}
