import { Fragment, useEffect, useRef, useState } from 'react';
import { ACTIONS, DEFAULT_SCENARIO, REQUIREMENTS, STEPS, enumerateRequests } from './core/scenario';
import type { AccessRequest, Decision } from './core/scenario';
import type { EngineResult, Evaluator, PolicyEngine } from './core/engine';
import { cedarEngine } from './engines/cedar';
import { buildPolicy, regoEngine, regoEvaluator } from './engines/rego';
import { casbinEngine } from './engines/casbin';
import {
  BUSINESS_HOURS,
  actionToRelation,
  explainRebac,
  rebacConditionsEngine,
  rebacEngine,
  type Variant,
} from './engines/rebac';
import { ensureRegoLoaded } from './engines/regoRuntime';
import { DayChart } from './components/DayChart';
import { DAY_HOURS, hh, minorityAt, splitHours } from './core/day';
import { MapKey, RequestMap } from './components/RequestMap';
import { deriveOutcome, rowKey } from './core/outcome';
import { RebacGraph } from './components/RebacGraph';
import { RegoEditor } from './components/RegoEditor';
import { SourceTabs } from './components/SourceTabs';
import { stageSummary, tallyState } from './core/tally';
import { LANGS, LANG_LABEL, UI, fill, readStoredLang, storeLang, type Lang } from './i18n';

const ALL_ENGINES: PolicyEngine[] = [
  cedarEngine,
  regoEngine,
  casbinEngine,
  rebacEngine,
  rebacConditionsEngine,
];
const SCENARIO = DEFAULT_SCENARIO;
// mfa affects none of the requirements, so it is pinned to one value rather than
// doubling the number of columns in the map for nothing. The hours are the two edges
// of the business-hours window and the hour on each side of them, so the grid shows
// the decision actually flipping rather than sampling the middle of the day twice.
const MAP_HOURS = [8, 9, 17, 18];
const MAP_REQUESTS = enumerateRequests(SCENARIO, MAP_HOURS, [true]);
const REPO = 'https://github.com/0-draft/authz-playground';

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

/**
 * An evaluator that fails reports deny with an error. For an edited policy that must
 * stop the run, or a policy that does not compile would pass as one denying everything.
 */
const failOnError = (ev: Evaluator): Evaluator => ({
  async decide(req) {
    const result = await ev.decide(req);
    if (result.error) throw new Error(result.error);
    return result;
  },
});

/** Every request in the map, in MAP_REQUESTS order. */
async function decideAll(ev: Evaluator): Promise<Decision[]> {
  const row: Decision[] = [];
  let sinceYield = performance.now();

  for (const req of MAP_REQUESTS) {
    row.push((await ev.decide(req)).decision);
    // The JS engines settle each decision in a microtask, so a plain loop never
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

export default function App() {
  const [lang, setLang] = useState<Lang>(readStoredLang);
  const [stepId, setStepId] = useState(3);
  const [regoReady, setRegoReady] = useState(false);
  const [rows, setRows] = useState<Record<string, Decision[]>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [req, setReq] = useState<AccessRequest>({
    subject: 'alice',
    action: 'edit',
    resource: 'design-doc',
    // 08:00 is the hour before opening, which is where the classic model parts ways.
    context: { hour: MAP_HOURS[0], mfa: true },
  });
  // Every engine's answer to the current question at each hour of the day. Stored with
  // the question it answers, so a late result for an old question is never drawn.
  const [day, setDay] = useState<{ key: string; results: Record<string, EngineResult[]> }>({
    key: '',
    results: {},
  });
  // Evaluators are compiled once per stage and engine, then shared by the sweep and
  // the question. Rego compiles a module on prepare, which is worth not repeating.
  const evaluators = useRef(new Map<string, Promise<Evaluator>>());
  // Rows already computed. Held in a ref so the sweep can skip them without making
  // itself a dependency of the effect that fills it.
  const computed = useRef<Set<string>>(new Set());

  const t = (l: { en: string; ja: string }) => l[lang];
  const engines = enginesFor(regoReady);
  // Engines that failed are left out of every comparison. Their rows never arrive, and
  // waiting on them held the page at "evaluating" indefinitely.
  const compared = engines.filter((e) => !failures[e.meta.id]);
  const comparedIds = compared.map((e) => e.meta.id);
  const step = STEPS.find((s) => s.id === stepId)!;
  const requirements = step.requirements;
  const dayKey = [stepId, regoReady, req.subject, req.action, req.resource].join('|');

  const evaluatorFor = (engine: PolicyEngine, sid: number): Promise<Evaluator> => {
    const k = rowKey(sid, engine.meta.id);
    let ev = evaluators.current.get(k);
    if (!ev) {
      ev = engine.prepare(SCENARIO, STEPS.find((s) => s.id === sid)!.requirements);
      evaluators.current.set(k, ev);
    }
    return ev;
  };

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

  // Fill in every stage so the stage bar can show which engine broke where.
  //
  // One engine and one stage at a time, yielding between each: the whole sweep is
  // over a thousand evaluations, and running it as one uninterrupted chain froze the
  // page the moment the Rego module arrived. Rows are kept per engine, so Rego joining
  // adds its own rows instead of recomputing the engines that were already done.
  useEffect(() => {
    let alive = true;
    (async () => {
      // The stage on screen first, so the map fills before the stage bar does.
      const order = [stepId, ...STEPS.map((s) => s.id).filter((id) => id !== stepId)];
      for (const sid of order) {
        for (const engine of enginesFor(regoReady)) {
          const key = rowKey(sid, engine.meta.id);
          if (computed.current.has(key)) continue;
          try {
            // An evaluation error must not be counted as a deny vote, so it stops the
            // row and is reported as a failure instead.
            const row = await decideAll(failOnError(await evaluatorFor(engine, sid)));
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
  }, [regoReady, stepId]);

  // Ask the current question at every hour of the day, on every engine.
  useEffect(() => {
    let alive = true;
    (async () => {
      const next: Record<string, EngineResult[]> = {};
      for (const engine of enginesFor(regoReady)) {
        try {
          const ev = await evaluatorFor(engine, stepId);
          const out: EngineResult[] = [];
          for (const hour of DAY_HOURS) {
            out.push(await ev.decide({ ...req, context: { ...req.context, hour } }));
          }
          next[engine.meta.id] = out;
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          next[engine.meta.id] = DAY_HOURS.map(() => ({
            decision: 'deny' as const,
            reason: { en: 'The engine failed to run', ja: 'エンジンの実行に失敗した' },
            error: message,
          }));
        }
        await yieldToBrowser();
      }
      if (alive) setDay({ key: dayKey, results: next });
    })();
    return () => {
      alive = false;
    };
    // The question is fully described by dayKey; the hour is read from the results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  const results: Record<string, EngineResult[] | undefined> = day.key === dayKey ? day.results : {};
  const hour = req.context.hour;
  const setHour = (h: number) => setReq((r) => ({ ...r, context: { ...r.context, hour: h } }));
  const split = splitHours(results);
  const splitNow = split.has(hour);
  const oddNow = minorityAt(results, hour);

  const outcome = deriveOutcome(rows, stepId, comparedIds);
  const selectedIndex = MAP_REQUESTS.findIndex(
    (r) =>
      r.subject === req.subject &&
      r.action === req.action &&
      r.resource === req.resource &&
      r.context.hour === req.context.hour,
  );
  // null means "still evaluating", which must not render as "everything agrees".
  const clashCount = outcome ? outcome.clash.filter(Boolean).length : null;
  const tally = tallyState(clashCount, compared.length, ALL_ENGINES.length);

  const projections = engines.map((e) => ({
    engine: e.meta,
    projection: e.project(SCENARIO, requirements, lang),
  }));

  const explain = (variant: Variant) => explainRebac(SCENARIO, requirements, req, variant);
  const repLabel = { native: UI.repNative, awkward: UI.repAwkward, impossible: UI.repImpossible };

  const select = (field: 'subject' | 'action' | 'resource', options: readonly string[]) => (
    <select
      className="ask-field"
      aria-label={t(
        { subject: UI.askSubjectLabel, action: UI.askActionLabel, resource: UI.askResourceLabel }[
          field
        ],
      )}
      value={req[field]}
      onChange={(e) => setReq({ ...req, [field]: e.target.value })}
    >
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
  const hourField = (
    <select
      className="ask-field"
      aria-label={t(UI.hourLabel)}
      value={hour}
      onChange={(e) => setHour(Number(e.target.value))}
    >
      {DAY_HOURS.map((h) => (
        <option key={h} value={h}>
          {hh(h)}
        </option>
      ))}
    </select>
  );
  const users = SCENARIO.users;
  const docs = Object.keys(SCENARIO.documents);

  return (
    <>
      <a className="skip-link" href="#ask">
        {t(UI.askHeading)}
      </a>

      <header className="masthead">
        <div className="masthead-top">
          <p className="wordmark">Authz Playground</p>
          <div className="masthead-tools">
            <a href={REPO}>{t(UI.source)}</a>
            <div className="langswitch" role="group" aria-label={t(UI.langLabel)}>
              {LANGS.map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={l === lang}
                  onClick={() => setLang(l)}
                  lang={l}
                >
                  {LANG_LABEL[l]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="masthead-body">
          <h1>{t(UI.title)}</h1>
          <p className="intro">{t(UI.intro)}</p>
        </div>
      </header>

      <nav className="stagebar" aria-label={t(UI.stagesLabel)}>
        <ol>
          {STEPS.map((s) => {
            const sum = stageSummary(
              deriveOutcome(rows, s.id, comparedIds),
              compared.length,
              ALL_ENGINES.length,
            );
            const split = sum.state === 'disagree';
            const status =
              sum.state === 'evaluating'
                ? t(UI.stagePending)
                : sum.state === 'agree-partial'
                  ? t(UI.stageAgreePartial)
                  : sum.state === 'agree'
                    ? t(UI.stageAgree)
                    : sum.outliers.length > 0
                      ? sum.outliers
                          .map(
                            ([id, n]) =>
                              `${ALL_ENGINES.find((e) => e.meta.id === id)!.meta.name}: ${fill(t(UI.stageSplit), n)}`,
                          )
                          .join(', ')
                      : fill(t(UI.stageSplit), sum.clashes ?? 0);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={s.id === stepId ? 'step' : undefined}
                  onClick={() => setStepId(s.id)}
                >
                  <span className="sb-n">{s.id}</span>
                  <span className="sb-body">
                    <span className="sb-title">{t(s.title)}</span>
                    <span className="sb-count" data-split={split} aria-hidden="true">
                      {sum.state === 'evaluating' ? '…' : sum.clashes}
                    </span>
                    <span className="sb-status" data-split={split}>
                      {status}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <main>
        {(!regoReady && !failures.rego) || Object.keys(failures).length > 0 ? (
          <div className="notices">
            {!regoReady && !failures.rego && <p className="notice">{t(UI.regoLoading)}</p>}
            {Object.keys(failures).length > 0 && (
              <p className="notice failed" role="alert">
                {t(UI.engineFailed)}{' '}
                {Object.entries(failures).map(([id, message]) => (
                  <span key={id}>
                    {ALL_ENGINES.find((e) => e.meta.id === id)?.meta.name ?? id}: {message}
                  </span>
                ))}
              </p>
            )}
          </div>
        ) : null}

        <section className="rule" aria-label={t(UI.stageAdds)}>
          <span className="rule-id">{step.added}</span>
          <p className="rule-added">{t(REQUIREMENTS[step.added].label)}</p>
          <p className="rule-pain">{t(step.pain)}</p>
        </section>

        <section className="block" id="ask" aria-labelledby="ask-h">
          <h2 id="ask-h" tabIndex={-1}>
            {t(UI.askHeading)}
          </h2>
          <p className="question">
            {/* The word order differs by language, so the sentence is a template whose
                slots are the four fields of the request. */}
            {t(UI.askSentence)
              .split(/(%[sarh])/)
              .map((part, i) =>
                part === '%s' ? (
                  <Fragment key={i}>{select('subject', users)}</Fragment>
                ) : part === '%a' ? (
                  <Fragment key={i}>{select('action', ACTIONS)}</Fragment>
                ) : part === '%r' ? (
                  <Fragment key={i}>{select('resource', docs)}</Fragment>
                ) : part === '%h' ? (
                  <Fragment key={i}>{hourField}</Fragment>
                ) : (
                  part
                ),
              )}
          </p>
          <DayChart
            lang={lang}
            engines={engines.map((e) => e.meta)}
            results={results}
            hour={hour}
            onHour={setHour}
            showHours={requirements.includes('R3')}
          />
          <p className="caption">{t(UI.askLede)}</p>

          <div className="why">
            <dl>
              {engines.map((e) => {
                const r = results[e.meta.id]?.[hour];
                return (
                  <div key={e.meta.id} data-odd={oddNow.has(e.meta.id)}>
                    <dt>{e.meta.name}</dt>
                    <dd>{r ? (r.error ?? t(r.reason)) : t(UI.evaluating)}</dd>
                  </div>
                );
              })}
            </dl>
            {splitNow && (
              <aside className="redline">
                <p className="redline-head">{fill(t(UI.splitHere), hh(hour))}</p>
                <p>
                  {engines
                    .filter((e) => oddNow.has(e.meta.id))
                    .flatMap((e) => {
                      const s = e.project(SCENARIO, requirements, lang).support;
                      const missing = requirements.find((rq) => s[rq]?.level === 'impossible');
                      return missing
                        ? [
                            fill(
                              t(UI.cannotExpress),
                              e.meta.name,
                              t(REQUIREMENTS[missing].label),
                              t(s[missing].note),
                            ),
                          ]
                        : [];
                    })
                    .join(' ') || t(UI.clashGeneric)}
                </p>
              </aside>
            )}
          </div>
        </section>

        <section className="block" aria-labelledby="map-h">
          <h2 id="map-h">{t(UI.mapHeading)}</h2>
          <p className="lede">{fill(t(UI.mapLede), MAP_REQUESTS.length)}</p>
          <p className="tally" data-tally={tally} aria-live="polite">
            {tally === 'evaluating' ? (
              t(UI.evaluating)
            ) : tally === 'agree-partial' ? (
              fill(
                t(UI.tallyCleanPartial),
                compared.length,
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
          <MapKey lang={lang} />
          <RequestMap
            lang={lang}
            engines={compared.map((e) => e.meta)}
            requests={MAP_REQUESTS}
            outcome={outcome}
            selected={selectedIndex}
            onSelect={(i) => {
              setReq(MAP_REQUESTS[i]);
              // The answer is drawn above, so take focus there too. Scrolling alone left
              // keyboard and screen-reader users inside the grid, away from what changed.
              const heading = document.getElementById('ask-h');
              heading?.focus({ preventScroll: true });
              document.getElementById('ask')?.scrollIntoView({ block: 'start' });
            }}
          />
        </section>

        <section className="block" aria-labelledby="graph-h">
          <h2 id="graph-h">{t(UI.graphHeading)}</h2>
          <p className="lede">{t(UI.graphLede)}</p>
          <div className="graphs">
            {(['classic', 'conditions'] as const).map((variant) => {
              const x = explain(variant);
              const relation = actionToRelation(req.action);
              return (
                <figure className="graph" key={variant}>
                  <figcaption>
                    <span className="graph-name">
                      {t(variant === 'classic' ? UI.variantClassic : UI.variantConditions)}
                    </span>
                    <span className="graph-result" data-d={x.ok ? 'allow' : 'deny'}>
                      {fill(t(x.ok ? UI.graphReached : UI.graphNotReached), relation)}
                    </span>
                  </figcaption>
                  <RebacGraph
                    tuples={x.tuples}
                    path={x.path}
                    label={t(UI.graphAlt)}
                    conditionState={(tp) => {
                      if (!tp.condition) return undefined;
                      const holds = BUSINESS_HOURS.holds(req.context);
                      return {
                        holds,
                        caption: fill(t(holds ? UI.conditionTrue : UI.conditionFalse), hh(hour)),
                      };
                    }}
                  />
                  <details className="trace">
                    <summary>{t(UI.traceLabel)}</summary>
                    <pre tabIndex={0}>{x.trace.join('\n')}</pre>
                  </details>
                </figure>
              );
            })}
          </div>
        </section>

        <section className="block" aria-labelledby="matrix-h">
          <h2 id="matrix-h">{t(UI.matrixHeading)}</h2>
          <p className="lede">{t(UI.matrixLede)}</p>
          <div className="scroll-x" tabIndex={0} role="region" aria-labelledby="matrix-h">
            <table className="express">
              <thead>
                <tr>
                  <td />
                  {requirements.map((rq) => (
                    <th scope="col" key={rq}>
                      <span className="rule-id">{rq}</span>
                      <span className="express-rule">{t(REQUIREMENTS[rq].label)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projections.map(({ engine, projection }) => (
                  <tr key={engine.id}>
                    <th scope="row">{engine.name}</th>
                    {requirements.map((rq) => {
                      const s = projection.support[rq];
                      return (
                        <td key={rq} data-l={s.level}>
                          <span className="rep">
                            <i aria-hidden="true" />
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

        <section className="block" aria-labelledby="proj-h">
          <h2 id="proj-h">{t(UI.projHeading)}</h2>
          <p className="lede">{t(UI.projLede)}</p>
          <SourceTabs lang={lang} items={projections} />
        </section>

        {/* Without the OPA module there is nothing to edit against; the notice above
            already says why, so the section is left out rather than waiting forever. */}
        {!failures.rego && (
          <section className="block" aria-labelledby="edit-h">
            <h2 id="edit-h">{t(UI.editHeading)}</h2>
            <p className="lede">{t(UI.editLede)}</p>
            <RegoEditor
              // Remount on a new stage, so an edit is not carried across to rules it was
              // not written against. A language switch only changes the comments, so the
              // editor keeps the edit and swaps in the translated text only if untouched.
              key={stepId}
              lang={lang}
              initial={buildPolicy(requirements, lang)}
              requests={MAP_REQUESTS}
              shipped={regoReady ? rows[rowKey(stepId, 'rego')] : undefined}
              evaluate={(policy) => decideAll(failOnError(regoEvaluator(SCENARIO, policy)))}
            />
          </section>
        )}
      </main>

      <footer className="foot">
        <div className="foot-inner">
          <p>{t(UI.footer)}</p>
          <p>
            <a href={REPO}>{t(UI.source)}</a>
          </p>
        </div>
      </footer>
    </>
  );
}
