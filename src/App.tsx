import { useEffect, useState } from 'react';
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
import {
  LANGS,
  LANG_LABEL,
  LangContext,
  UI,
  fill,
  readStoredLang,
  storeLang,
  type Lang,
} from './i18n';

const ALL_ENGINES: PolicyEngine[] = [cedarEngine, regoEngine, casbinEngine, rebacEngine];
const SCENARIO = DEFAULT_SCENARIO;
// mfa affects none of the requirements, so it is pinned to one value rather than
// doubling the number of columns in the map for nothing.
const MAP_REQUESTS = enumerateRequests(SCENARIO, [3, 10, 14, 22], [true]);

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

async function evaluateStep(
  engines: PolicyEngine[],
  requirements: readonly string[],
): Promise<StepOutcome> {
  const decisions: Record<string, Decision[]> = {};
  for (const engine of engines) {
    const ev = await engine.prepare(SCENARIO, requirements);
    const row: Decision[] = [];
    for (const req of MAP_REQUESTS) row.push((await ev.decide(req)).decision);
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
      const minority: Decision = allows * 2 < votes.length ? 'allow' : 'deny';
      engines.forEach((e, k) => {
        if (votes[k] === minority) breaks[e.meta.id] += 1;
      });
    }
  });

  return { decisions, clash, breaks };
}

export default function App() {
  const [lang, setLang] = useState<Lang>(readStoredLang);
  const [stepId, setStepId] = useState(3);
  const [regoReady, setRegoReady] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<number, StepOutcome> | null>(null);
  const [live, setLive] = useState<Record<string, EngineResult>>({});
  const [req, setReq] = useState<AccessRequest>({
    subject: 'alice',
    action: 'edit',
    resource: 'design-doc',
    context: { hour: 3, mfa: true },
  });

  const t = (l: { en: string; ja: string }) => l[lang];
  const engines = enginesFor(regoReady);
  const step = STEPS.find((s) => s.id === stepId)!;
  const requirements = step.requirements;

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
      .catch((e) => console.error('rego wasm:', e));
    return () => {
      alive = false;
    };
  }, []);

  // Evaluate every stage up front, so the stage rail can show which engine broke where.
  useEffect(() => {
    let alive = true;
    (async () => {
      const acc: Record<number, StepOutcome> = {};
      const list = enginesFor(regoReady);
      for (const s of STEPS) acc[s.id] = await evaluateStep(list, s.requirements);
      if (alive) setOutcomes(acc);
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
        const ev = await engine.prepare(SCENARIO, requirements);
        next[engine.meta.id] = await ev.decide(req);
      }
      if (alive) setLive(next);
    })();
    return () => {
      alive = false;
    };
  }, [regoReady, requirements, req]);

  const outcome = outcomes?.[stepId];
  const selectedIndex = MAP_REQUESTS.findIndex(
    (r) =>
      r.subject === req.subject &&
      r.action === req.action &&
      r.resource === req.resource &&
      r.context.hour === req.context.hour,
  );

  const liveDecisions = engines.map((e) => live[e.meta.id]?.decision).filter(Boolean);
  const liveClash = new Set(liveDecisions).size > 1;
  const clashCount = outcome?.clash.filter(Boolean).length ?? 0;

  const rebac = explainRebac(SCENARIO, requirements, req);
  const projections = engines.map((e) => ({
    engine: e,
    projection: e.project(SCENARIO, requirements, lang),
  }));

  const repLabel = { native: UI.repNative, awkward: UI.repAwkward, impossible: UI.repImpossible };

  return (
    <LangContext.Provider value={lang}>
      <div className="shell">
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

        {!regoReady && <p className="loadbar">{t(UI.regoLoading)}</p>}

        <nav className="stages" aria-label={t(UI.stagesLabel)}>
          {STEPS.map((s) => {
            const o = outcomes?.[s.id];
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
                        fill(t(UI.broke), ALL_ENGINES.find((e) => e.meta.id === id)!.meta.name, n),
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

          <div className="map-wrap">
            <div className="map">
              {engines.map((engine) => (
                <div className="map-row" key={engine.meta.id}>
                  <span className="map-label">{engine.meta.name}</span>
                  <div
                    className="map-cells"
                    style={{
                      gridTemplateColumns: `repeat(${MAP_REQUESTS.length}, minmax(0, 1fr))`,
                    }}
                  >
                    {MAP_REQUESTS.map((r, i) => {
                      const d = outcome?.decisions[engine.meta.id]?.[i];
                      const label = `${formatRequest(r)} → ${d ?? '…'}`;
                      return (
                        <button
                          key={i}
                          className="cell"
                          data-d={d}
                          data-clash={outcome?.clash[i] ?? false}
                          data-sel={i === selectedIndex}
                          title={label}
                          aria-label={label}
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
              {t(UI.keyClash)}
            </span>
          </div>

          <p className={`tally${clashCount === 0 ? ' clean' : ''}`}>
            {clashCount === 0 ? (
              fill(t(UI.tallyClean), MAP_REQUESTS.length)
            ) : (
              <>
                <b>{clashCount}</b> {fill(t(UI.tallyClash), MAP_REQUESTS.length)}
              </>
            )}
          </p>
        </section>

        <section className="section">
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
          <div className="graph">
            <RebacGraph tuples={rebac.tuples} path={rebac.path} label={t(UI.graphAlt)} />
            <pre className="trace">{rebac.trace.join('\n')}</pre>
          </div>
        </section>

        <section className="section">
          <h2>{t(UI.matrixHeading)}</h2>
          <p className="lede">{t(UI.matrixLede)}</p>
          <div className="matrix-wrap">
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
                      <pre>{src.code || t(UI.emptyAtStage)}</pre>
                      {src.note && <p className="note">{t(src.note)}</p>}
                    </>
                  );
                  return (
                    <div className="src" key={src.label}>
                      {bulky ? (
                        <details>
                          <summary>
                            {src.label}
                            <span>{fill(t(UI.lineCount), src.code.split('\n').length)}</span>
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

        <footer className="foot">
          <p>{t(UI.footer)}</p>
        </footer>
      </div>
    </LangContext.Provider>
  );
}
