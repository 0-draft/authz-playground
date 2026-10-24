import { useEffect, useState } from 'react';
import type { AccessRequest, Decision } from '../core/scenario';
import { formatRequest } from '../core/scenario';
import { UI, fill, type Lang } from '../i18n';

/** Long enough that typing a word does not trigger 72 wasm evaluations per keystroke. */
const DEBOUNCE_MS = 300;
const MAX_LISTED = 8;

/** Stored with the policy it answers, so a result for older text is never shown. */
type Run = { code: string } & ({ error: string } | { decisions: Decision[] });

interface Props {
  lang: Lang;
  /** The policy shipped for the current stage, which the editor starts from. */
  initial: string;
  requests: readonly AccessRequest[];
  /** The shipped policy's decisions, or undefined until Rego has evaluated them. */
  shipped: Decision[] | undefined;
  /** Rejects with OPA's message when the policy does not compile or evaluate. */
  evaluate(policy: string): Promise<Decision[]>;
}

/**
 * An editable copy of the Rego projection. Every edit re-runs the whole map and is
 * compared with the shipped policy, not with the other engines, so editing cannot
 * change what the comparison above reports.
 */
export function RegoEditor({ lang, initial, requests, shipped, evaluate }: Props) {
  const [code, setCode] = useState(initial);
  const [shown, setShown] = useState(initial);
  // A new `initial` here means the language changed. Follow it only while the text is
  // still the policy as shipped, so switching language never discards an edit.
  if (initial !== shown) {
    setShown(initial);
    if (code === shown) setCode(initial);
  }
  const [run, setRun] = useState<Run | null>(null);
  const ready = shipped !== undefined;
  const t = (l: { en: string; ja: string }) => l[lang];

  useEffect(() => {
    if (!ready || code === initial) return;
    let alive = true;
    const timer = setTimeout(() => {
      evaluate(code).then(
        (decisions) => alive && setRun({ code, decisions }),
        (e: unknown) =>
          alive && setRun({ code, error: e instanceof Error ? e.message : String(e) }),
      );
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // evaluate is recreated on every render of the parent; the policy text is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, initial, ready]);

  const current = run?.code === code ? run : null;
  const changed =
    current && 'decisions' in current && shipped
      ? requests.flatMap((r, i) =>
          current.decisions[i] === shipped[i]
            ? []
            : [{ r, from: shipped[i], to: current.decisions[i] }],
        )
      : [];
  const verdict = (d: Decision) => t(d === 'allow' ? UI.allowWord : UI.denyWord);

  return (
    <div className="rego-editor">
      <div className="rego-editor-head">
        <label htmlFor="rego-edit">{t(UI.editLabel)}</label>
        <button type="button" disabled={code === initial} onClick={() => setCode(initial)}>
          {t(UI.editReset)}
        </button>
      </div>
      <textarea
        id="rego-edit"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        rows={Math.min(24, initial.split('\n').length + 2)}
      />
      <div className="rego-editor-result" aria-live="polite">
        {!ready ? (
          <p>{t(UI.editWaiting)}</p>
        ) : code === initial ? null : !current ? (
          <p>{t(UI.evaluating)}</p>
        ) : 'error' in current ? (
          <>
            <p>{t(UI.editFailed)}</p>
            <pre>{current.error}</pre>
          </>
        ) : changed.length > 0 ? (
          <>
            <p>{fill(t(UI.editDiff), changed.length, requests.length)}</p>
            <ul>
              {changed.slice(0, MAX_LISTED).map(({ r, from, to }) => (
                <li key={formatRequest(r)}>
                  {formatRequest(r)}: {verdict(from)} → <b data-d={to}>{verdict(to)}</b>
                </li>
              ))}
            </ul>
            {changed.length > MAX_LISTED && (
              <p>{fill(t(UI.editMore), changed.length - MAX_LISTED)}</p>
            )}
          </>
        ) : (
          <p>{fill(t(UI.editSame), requests.length)}</p>
        )}
      </div>
    </div>
  );
}
