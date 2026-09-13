import { useEffect, useRef, useState } from 'react';
import {
  ACTIONS,
  DEFAULT_SCENARIO,
  REQUIREMENTS,
  STEPS,
  enumerateRequests,
  formatRequest,
} from './core/scenario';
import type { AccessRequest, Decision } from './core/scenario';
import type { EngineResult, PolicyEngine } from './core/engine';
import { cedarEngine } from './engines/cedar';
import { regoEngine } from './engines/rego';
import { casbinEngine } from './engines/casbin';
import { explainRebac, rebacEngine } from './engines/rebac';
import { ensureRegoLoaded } from './engines/regoRuntime';
import { RebacGraph } from './components/RebacGraph';
import { tallyState } from './core/tally';
import { LANGS, LANG_LABEL, UI, fill, readStoredLang, storeLang, type Lang } from './i18n';

const ALL_ENGINES: PolicyEngine[] = [cedarEngine, regoEngine, casbinEngine, rebacEngine];
const SCENARIO = DEFAULT_SCENARIO;
// mfa affects none of the requirements, so it is pinned to one value rather than
// doubling the number of columns in the map for nothing. The hours are the two edges
// of the business-hours window and the hour on each side of them, so the grid shows
// the decision actually flipping rather than sampling the middle of the day twice.
const MAP_HOURS = [8, 9, 17, 18];
const MAP_REQUESTS = enumerateRequests(SCENARIO, MAP_HOURS, [true]);

/**
 * Hands the event loop back so a long sweep cannot freeze the page.
 *
 * scheduler.yield resumes at the head of the queue where it exists, so the sweep keeps
 * its priority instead of going to the back behind every pending timer.
 */
const yieldToBrowser = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
};

/**
 * Rego only joins once its wasm module has loaded. This returns a new array each
 * call, so effects depend on `regoReady` rather than on the array itself.
 */
function enginesFor(regoReady: boolean): PolicyEngine[] {
  return regoReady ? ALL_ENGINES : ALL_ENGINES.filter((e) => e.meta.id !== 'rego');
}

interface StepOutcome {
  /** engine id -> the decision for each request, in MAP_REQUESTS order */
  decisions: Record<string, Decision[]>;
  /** whether the engines disagreed, per request */
  clash: boolean[];
  /** engine id -> how many times it was in the minority */
  breaks: Record<string, number>;
}

/** One engine's decisions for one stage. Kept separate so Rego can be merged in later. */
async function evaluateRow(
  engine: PolicyEngine,
  requirements: readonly string[],
): Promise<Decision[]> {
  const ev = await engine.prepare(SCENARIO, requirements);
  const row: Decision[] = [];
  let sinceYield = performance.now();

  for (const req of MAP_REQUESTS) {
    row.push((await ev.decide(req)).decision);
    // The three JS engines settle each decision in a microtask, so a plain loop never
    // returns to the event loop. That is free when a decision costs microseconds and
    // ruinous for Rego, where each one is a wasm evaluation: 72 back to back measured
    // as a single 185 ms task. Yielding on elapsed time costs the fast engines nothing.
    if (performance.now() - sinceYield > 4) {
      await yieldToBrowser();
      sinceYield = performance.now();
    }
  }
  return row;
}

/**
 * Derive the comparison for one stage, or null while any engine's row is still
 * missing. Returning null matters: treating "not computed yet" as "no disagreement"
 * would make the page claim every engine agrees before it has evaluated anything.
 */
function deriveOutcome(
  rows: Record<string, Decision[]>,
  stepId: number,
  engines: PolicyEngine[],
): StepOutcome | null {
  const decisions: Record<string, Decision[]> = {};
  for (const engine of engines) {
    const row = rows[`${stepId}:${engine.meta.id}`];
    if (!row) return null;
    decisions[engine.meta.id] = row;
  }

  const clash: boolean[] = [];
  const breaks: Record<string, number> = Object.fromEntries(engines.map((e) => [e.meta.id, 0]));

  MAP_REQUESTS.forEach((_, i) => {
    const votes = engines.map((e) => decisions[e.meta.id][i]);
    const differs = new Set(votes).size > 1;
    clash.push(differs);
    if (differs) {
      const allows = votes.filter((v) => v === 'allow').length;
      const denies = votes.length - allows;
      // An even split has no minority. The old ternary fell through to 'deny' and
      // charged both denying engines a break for being exactly half the vote. Latent
      // with four engines and this scenario, wrong the moment either changes.
      if (allows !== denies) {
        const minority: Decision = allows < denies ? 'allow' : 'deny';
        engines.forEach((e, k) => {
          if (votes[k] === minority) breaks[e.meta.id] += 1;
        });
      }
    }
  });

  return { decisions, clash, breaks };
}

const rowKey = (stepId: number, engineId: string) => `${stepId}:${engineId}`;

export default function App() {
  const [lang, setLang] = useState<Lang>(readStoredLang);
  const [stepId, setStepId] = useState(1);
  const [regoReady, setRegoReady] = useState(false);
  const [rows, setRows] = useState<Record<string, Decision[]>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  // Verdicts are stored with the request they answer. Rendering compares that key
  // against the current request, so a result for a request the user has moved away
  // from is ignored instead of being shown as the answer to the new one.
  const [liveState, setLiveState] = useState<{
    key: string;
    results: Record<string, EngineResult>;
  }>({ key: '', results: {} });
  // Rows already computed. Held in a ref so the sweep can skip them without making
  // itself a dependency of the effect that fills it.
  const computed = useRef<Set<string>>(new Set());
  // The grid holds 288 buttons. Exactly one is in the tab order at a time and the
  // arrow keys move between them, so reaching the controls below no longer costs
  // 288 presses of Tab.
  // Held as (engine, column) rather than a flat row*columns index: the engine list grows
  // from three to four when Rego's module lands, and a flat index silently re-pointed at
  // a different engine mid-session.
  const [cursor, setCursor] = useState<{ engineId: string; col: number }>({
    engineId: ALL_ENGINES[0].meta.id,
    col: 0,
  });
  const gridRef = useRef<HTMLDivElement>(null);
  const [req, setReq] = useState<AccessRequest>({
    subject: 'alice',
    action: 'edit',
    resource: 'design-doc',
    // Must be an hour the grid actually plots, or the page names a selected request that
    // no cell reflects. 08:00 is outside business hours, which is the interesting side.
    context: { hour: MAP_HOURS[0], mfa: true },
  });

  const t = (l: { en: string; ja: string }) => l[lang];
  const engines = enginesFor(regoReady);
  const step = STEPS.find((s) => s.id === stepId)!;
  const requirements = step.requirements;
  const liveKey = [
    stepId,
    regoReady,
    req.subject,
    req.action,
    req.resource,
    req.context.hour,
    req.context.mfa,
  ].join('|');

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = UI.docTitle[lang];
    storeLang(lang);
  }, [lang]);

  // The OPA module is roughly 8 MB gzipped. Load it in the background so the page
  // is usable immediately, and let it join the comparison when it arrives.
  useEffect(() => {
    let alive = true;
    ensureRegoLoaded()
      .then(() => alive && setRegoReady(true))
      .catch((e: unknown) => {
        if (!alive) return;
        setFailures((f) => ({ ...f, rego: e instanceof Error ? e.message : String(e) }));
      });
    return () => {
      alive = false;
    };
  }, []);

  // Fill in every stage so the stage rail can show which engine broke where.
  //
  // One engine and one stage at a time, yielding between each: the whole sweep is
  // ~1150 synchronous evaluations, and running it as a single uninterrupted chain
  // froze the page for most of a second the moment the Rego module arrived. Rows are
  // also kept per engine, so Rego joining adds its own rows instead of recomputing
  // the three engines that were already done.
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const step of STEPS) {
        for (const engine of enginesFor(regoReady)) {
          const key = rowKey(step.id, engine.meta.id);
          if (computed.current.has(key)) continue;
          try {
            const row = await evaluateRow(engine, step.requirements);
            if (!alive) return;
            computed.current.add(key);
            setRows((prev) => ({ ...prev, [key]: row }));
          } catch (e: unknown) {
            if (!alive) return;
            const message = e instanceof Error ? e.message : String(e);
            setFailures((f) => ({ ...f, [engine.meta.id]: message }));
          }
          await yieldToBrowser();
        }
      }
    })();
    return () => {
      alive = false;
    };
    // enginesFor() returns a fresh array each call, so depend on the flag behind it.
  }, [regoReady]);

  // Evaluate the selected request on every engine, with reasons.
  useEffect(() => {
    let alive = true;
    (async () => {
      const next: Record<string, EngineResult> = {};
      for (const engine of enginesFor(regoReady)) {
        try {
          const ev = await engine.prepare(SCENARIO, requirements);
          next[engine.meta.id] = await ev.decide(req);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          next[engine.meta.id] = {
            decision: 'deny',
            reason: { en: 'The engine failed to run', ja: 'エンジンの実行に失敗した' },
            error: message,
          };
        }
      }
      if (alive) setLiveState({ key: liveKey, results: next });
    })();
    return () => {
      alive = false;
    };
  }, [regoReady, requirements, req, liveKey]);

  const live = liveState.key === liveKey ? liveState.results : {};
  const outcome = deriveOutcome(rows, stepId, engines);
  const selectedIndex = MAP_REQUESTS.findIndex(
    (r) =>
      r.subject === req.subject &&
      r.action === req.action &&
      r.resource === req.resource &&
      r.context.hour === req.context.hour,
  );

  const liveDecisions = engines.map((e) => live[e.meta.id]?.decision).filter(Boolean);
  const liveClash = new Set(liveDecisions).size > 1;
  // null means "still evaluating", which must not render as "everything agrees".
  const clashCount = outcome ? outcome.clash.filter(Boolean).length : null;
  const tally = tallyState(clashCount, engines.length, ALL_ENGINES.length);

  const rebac = explainRebac(SCENARIO, requirements, req);
  const projections = engines.map((e) => ({
    engine: e,
    projection: e.project(SCENARIO, requirements, lang),
  }));

  const repLabel = { native: UI.repNative, awkward: UI.repAwkward, impossible: UI.repImpossible };

  return (
    <>
      <div className="shell">
        <a className="skip-link" href="#bench">
          {t(UI.skipToBench)}
        </a>
        <header className="masthead">
          <div className="langswitch" role="group" aria-label={t(UI.langLabel)}>
            {LANGS.map((l) => (
              <button key={l} aria-pressed={l === lang} onClick={() => setLang(l)} lang={l}>
                {LANG_LABEL[l]}
              </button>
            ))}
          </div>
          <h1>
            {t(UI.title)
              .split('\n')
              .map((line, i) => (
                <span key={i}>
                  {line}
                  <br />
                </span>
              ))}
          </h1>
          <p>{t(UI.intro)}</p>
        </header>

        <main>
          {!regoReady && !failures.rego && <p className="loadbar">{t(UI.regoLoading)}</p>}

          {Object.entries(failures).length > 0 && (
            <p className="failbar" role="alert">
              {t(UI.engineFailed)}
              {Object.entries(failures).map(([id, message]) => (
                <span key={id}>
                  {ALL_ENGINES.find((e) => e.meta.id === id)?.meta.name ?? id}: {message}
                </span>
              ))}
            </p>
          )}

          <nav className="stages" aria-label={t(UI.stagesLabel)}>
            {STEPS.map((s) => {
              const o = deriveOutcome(rows, s.id, engines);
              const broken = o ? Object.entries(o.breaks).filter(([, n]) => n > 0) : [];
              return (
                <button
                  key={s.id}
                  className="stage-btn"
                  aria-current={s.id === stepId}
                  onClick={() => setStepId(s.id)}
                >
                  <span className="n">{fill(t(UI.stageOf), s.id, STEPS.length)}</span>
                  <span className="tt">{t(s.title)}</span>
                  {broken.length > 0 && (
                    <span className="broke">
                      {broken
                        .map(([id, n]) =>
                          fill(
                            t(UI.broke),
                            ALL_ENGINES.find((e) => e.meta.id === id)!.meta.name,
                            n,
                          ),
                        )
                        .join(' / ')}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <p className="stage-pain">
            <strong>+ {t(REQUIREMENTS[step.added].label)}</strong>
            <br />
            {t(step.pain)}
          </p>

          <section className="section">
            <h2>{t(UI.mapHeading)}</h2>
            <p className="lede">{fill(t(UI.mapLede), MAP_REQUESTS.length)}</p>

            <p className="map-readout">
              <span className="cursor-part">
                {(() => {
                  const r = MAP_REQUESTS[cursor.col];
                  const engine = engines.find((x) => x.meta.id === cursor.engineId) ?? engines[0];
                  const d = outcome?.decisions[engine?.meta.id ?? '']?.[cursor.col];
                  return (
                    <>
                      {engine?.meta.name} <span className="muted">·</span> {formatRequest(r)}{' '}
                      <span className="muted">·</span>{' '}
                      {d ? t(d === 'allow' ? UI.keyAllow : UI.keyDeny) : t(UI.evaluating)}
                    </>
                  );
                })()}
              </span>
              {/* Clicking a cell drives a panel that sits below the fold, so the answers it
                produces are repeated here, where the click happened. */}
              <span className="selected-part">
                <span className="muted">{t(UI.selectedRequest)}</span> {formatRequest(req)}
                {engines.map((e) => {
                  const r = live[e.meta.id];
                  return (
                    <span className="mini-verdict" key={e.meta.id} data-d={r?.decision}>
                      {e.meta.name} {r ? (r.decision === 'allow' ? 'ALLOW' : 'DENY') : '…'}
                    </span>
                  );
                })}
              </span>
            </p>

            <div className="map-wrap">
              <div
                className="map"
                role="grid"
                aria-label={t(UI.mapHeading)}
                ref={gridRef}
                onKeyDown={(e) => {
                  const cols = MAP_REQUESTS.length;
                  const row = Math.max(
                    0,
                    engines.findIndex((x) => x.meta.id === cursor.engineId),
                  );
                  const move = (r: number, c: number) => {
                    e.preventDefault();
                    const engineId = engines[r].meta.id;
                    setCursor({ engineId, col: c });
                    gridRef.current
                      ?.querySelector<HTMLButtonElement>(
                        `button.cell[data-engine="${engineId}"][data-col="${c}"]`,
                      )
                      ?.focus();
                  };
                  if (e.key === 'ArrowRight') move(row, Math.min(cols - 1, cursor.col + 1));
                  else if (e.key === 'ArrowLeft') move(row, Math.max(0, cursor.col - 1));
                  else if (e.key === 'ArrowDown')
                    move(Math.min(engines.length - 1, row + 1), cursor.col);
                  else if (e.key === 'ArrowUp') move(Math.max(0, row - 1), cursor.col);
                  else if (e.key === 'Home') move(row, 0);
                  else if (e.key === 'End') move(row, cols - 1);
                }}
                // Selecting a request selects its whole column, so four cells carry
                // aria-selected at once. Say so, rather than leaving a single-select
                // grid reporting four selections.
                aria-multiselectable="true"
              >
                {engines.map((engine) => (
                  <div className="map-row" role="row" key={engine.meta.id}>
                    <span className="map-label" role="rowheader">
                      {engine.meta.name}
                    </span>
                    <div
                      className="map-cells"
                      // Exists only to carry the grid-template style. Without a
                      // presentation role it sits between role="row" and the gridcells
                      // as a generic node, which is not a child a row is allowed to own.
                      role="presentation"
                      style={{
                        gridTemplateColumns: `repeat(${MAP_REQUESTS.length}, minmax(0, 1fr))`,
                      }}
                    >
                      {MAP_REQUESTS.map((r, i) => {
                        const d = outcome?.decisions[engine.meta.id]?.[i];
                        const clash = outcome?.clash[i] ?? false;
                        // The engine name lives in a row header that assistive tech does
                        // not read per cell, and disagreement was carried only by colour,
                        // so both go into the name.
                        const label = [
                          engine.meta.name,
                          formatRequest(r),
                          d ? t(d === 'allow' ? UI.keyAllow : UI.keyDeny) : t(UI.evaluating),
                          clash ? t(UI.keyClash) : '',
                        ]
                          .filter(Boolean)
                          .join(' · ');
                        return (
                          <button
                            key={i}
                            role="gridcell"
                            className="cell"
                            data-d={d}
                            data-clash={clash}
                            data-sel={i === selectedIndex}
                            data-engine={engine.meta.id}
                            data-col={i}
                            tabIndex={
                              engine.meta.id === cursor.engineId && i === cursor.col ? 0 : -1
                            }
                            aria-selected={i === selectedIndex}
                            title={label}
                            aria-label={label}
                            onFocus={() => setCursor({ engineId: engine.meta.id, col: i })}
                            // The readout was described as the hover position but only
                            // moved on focus, so a mouse user had to click a cell to learn
                            // what it was — and clicking changes the selection.
                            onMouseEnter={() => setCursor({ engineId: engine.meta.id, col: i })}
                            onClick={() => setReq(r)}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="map-axis">
                <span>{fill(t(UI.mapAxis), MAP_REQUESTS.length)}</span>
              </div>
            </div>

            <div className="map-key">
              <span>
                <i className="a" />
                {t(UI.keyAllow)}
              </span>
              <span>
                <i />
                {t(UI.keyDeny)}
              </span>
              <span>
                <i className="c" />
                {t(UI.keyClashDeny)}
              </span>
              <span>
                <i className="ca" />
                {t(UI.keyClashAllow)}
              </span>
            </div>

            <p
              className={`tally${tally === 'agree' ? ' clean' : ''}`}
              data-tally={tally}
              aria-live="polite"
            >
              {tally === 'evaluating' ? (
                t(UI.evaluating)
              ) : tally === 'agree-partial' ? (
                fill(
                  t(UI.tallyCleanPartial),
                  engines.length,
                  ALL_ENGINES.length,
                  MAP_REQUESTS.length,
                )
              ) : tally === 'agree' ? (
                fill(t(UI.tallyClean), MAP_REQUESTS.length)
              ) : (
                <>
                  <b>{clashCount}</b> {fill(t(UI.tallyClash), MAP_REQUESTS.length)}
                </>
              )}
            </p>
          </section>

          <section className="section" id="bench">
            <h2>{t(UI.benchHeading)}</h2>
            <p className="lede">{t(UI.benchLede)}</p>

            <div className="bench">
              <div className="builder">
                <div className="field">
                  <label htmlFor="f-sub">subject</label>
                  <select
                    id="f-sub"
                    value={req.subject}
                    onChange={(e) => setReq({ ...req, subject: e.target.value })}
                  >
                    {SCENARIO.users.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="f-act">action</label>
                  <select
                    id="f-act"
                    value={req.action}
                    onChange={(e) =>
                      setReq({ ...req, action: e.target.value as AccessRequest['action'] })
                    }
                  >
                    {ACTIONS.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="f-res">resource</label>
                  <select
                    id="f-res"
                    value={req.resource}
                    onChange={(e) => setReq({ ...req, resource: e.target.value })}
                  >
                    {Object.keys(SCENARIO.documents).map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="f-hour">context.hour</label>
                  <p className="hour">
                    {String(req.context.hour).padStart(2, '0')}:00
                    <small>
                      {req.context.hour >= 9 && req.context.hour < 18
                        ? t(UI.withinHours)
                        : t(UI.outsideHours)}
                    </small>
                  </p>
                  <input
                    id="f-hour"
                    type="range"
                    min={0}
                    max={23}
                    value={req.context.hour}
                    onChange={(e) =>
                      setReq({ ...req, context: { ...req.context, hour: Number(e.target.value) } })
                    }
                  />
                </div>
              </div>

              <div className="verdicts">
                {engines.map((engine) => {
                  const r = live[engine.meta.id];
                  const isOdd =
                    liveClash && r && liveDecisions.filter((d) => d === r.decision).length === 1;
                  return (
                    <div className="verdict" key={engine.meta.id} data-clash={Boolean(isOdd)}>
                      <h3>{engine.meta.name}</h3>
                      <p className="meta">
                        {engine.meta.year} · {engine.meta.origin}
                      </p>
                      {r ? (
                        <>
                          <span className="d" data-d={r.decision}>
                            {r.decision === 'allow' ? 'ALLOW' : 'DENY'}
                          </span>
                          <p className="why">{r.error ?? t(r.reason)}</p>
                        </>
                      ) : (
                        <span className="pending">{t(UI.evaluating)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="sr-only" role="status" aria-live="polite">
              {formatRequest(req)} —{' '}
              {engines
                .map((e) =>
                  fill(
                    t(UI.verdictSummary),
                    e.meta.name,
                    live[e.meta.id]
                      ? t(live[e.meta.id].decision === 'allow' ? UI.keyAllow : UI.keyDeny)
                      : t(UI.evaluating),
                  ),
                )
                .join(', ')}
            </p>

            {liveClash && (
              <div className="clash-call">
                <p className="head">{t(UI.clashHead)}</p>
                <p>
                  {engines
                    .flatMap((e) => {
                      const s = e.project(SCENARIO, requirements, lang).support;
                      const missing = requirements.find((rq) => s[rq]?.level === 'impossible');
                      if (!missing) return [];
                      return [
                        fill(
                          t(UI.cannotExpress),
                          e.meta.name,
                          t(REQUIREMENTS[missing].label),
                          t(s[missing].note),
                        ),
                      ];
                    })
                    .join(' ') || t(UI.clashGeneric)}
                </p>
              </div>
            )}
          </section>

          <section className="section">
            <h2>{t(UI.graphHeading)}</h2>
            <p className="lede">{t(UI.graphLede)}</p>
            <div className="graph" tabIndex={0} role="region" aria-label={t(UI.graphAlt)}>
              <RebacGraph tuples={rebac.tuples} path={rebac.path} label={t(UI.graphAlt)} />
              <pre className="trace">{rebac.trace.join('\n')}</pre>
            </div>
          </section>

          <section className="section">
            <h2>{t(UI.matrixHeading)}</h2>
            <p className="lede">{t(UI.matrixLede)}</p>
            <div
              className="matrix-wrap"
              tabIndex={0}
              role="region"
              aria-label={t(UI.matrixHeading)}
            >
              <table className="matrix">
                <thead>
                  <tr>
                    <th scope="col">{t(UI.colRequirement)}</th>
                    {engines.map((e) => (
                      <th scope="col" key={e.meta.id}>
                        {e.meta.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requirements.map((rq) => (
                    <tr key={rq}>
                      <th scope="row">
                        <b>{rq}</b>
                        {t(REQUIREMENTS[rq].label)}
                      </th>
                      {projections.map(({ engine, projection }) => {
                        const s = projection.support[rq];
                        return (
                          <td key={engine.meta.id}>
                            <span className="rep" data-l={s.level}>
                              {t(repLabel[s.level])}
                            </span>
                            <span className="rep-note">{t(s.note)}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="section">
            <h2>{t(UI.projHeading)}</h2>
            <p className="lede">{t(UI.projLede)}</p>
            <div className="proj">
              {projections.map(({ engine, projection }) => (
                <article className="proj-card" key={engine.meta.id}>
                  <header>
                    <h3>{engine.meta.name}</h3>
                    <span className="tag">{t(engine.meta.paradigm)}</span>
                  </header>
                  {projection.sources.map((src) => {
                    // Collapse only the bulky data blocks so they cannot bury the policy itself.
                    const bulky = src.code.length > 700;
                    const body = (
                      <>
                        <pre tabIndex={0} role="region" aria-label={src.label}>
                          {src.code || t(UI.emptyAtStage)}
                        </pre>
                        {src.note && <p className="note">{t(src.note)}</p>}
                      </>
                    );
                    return (
                      <div className="src" key={src.label}>
                        {bulky ? (
                          <details>
                            <summary>
                              {src.label}
                              <span className="lines">
                                {fill(t(UI.lineCount), src.code.split('\n').length)}
                              </span>
                            </summary>
                            {body}
                          </details>
                        ) : (
                          <>
                            <p className="src-name">{src.label}</p>
                            {body}
                          </>
                        )}
                      </div>
                    );
                  })}
                </article>
              ))}
            </div>
          </section>
        </main>

        <footer className="foot">
          <p>{t(UI.footer)}</p>
        </footer>
      </div>
    </>
  );
}
