import { useRef, useState } from 'react';
import type { EngineMeta, Projection, SourceView } from '../core/engine';
import { UI, fill, type Lang } from '../i18n';

/** Collapse only the bulky data blocks, so they cannot bury the policy itself. */
const BULKY = 700;

/** Comment syntax per source language. Comments are set apart; nothing else is coloured. */
const COMMENT: Partial<Record<SourceView['lang'], RegExp>> = {
  rego: /^(\s*)(#.*)$/,
  dsl: /^(\s*)(#.*)$/,
  ini: /^(\s*)([#;].*)$/,
  cedar: /^(\s*)(\/\/.*)$/,
};

function Code({ src, empty }: { src: SourceView; empty: string }) {
  if (!src.code) return <pre className="code">{empty}</pre>;
  const comment = COMMENT[src.lang];
  const lines = src.code.split('\n');
  return (
    <pre className="code" tabIndex={0} role="region" aria-label={src.label}>
      {lines.map((line, i) => {
        const m = comment?.exec(line);
        return (
          <span className="ln" key={i}>
            {m ? (
              <>
                {m[1]}
                <span className="cm">{m[2]}</span>
              </>
            ) : (
              line
            )}
            {'\n'}
          </span>
        );
      })}
    </pre>
  );
}

interface Props {
  lang: Lang;
  items: { engine: EngineMeta; projection: Projection }[];
}

/** One engine's sources at a time, behind an ARIA tab list. */
export function SourceTabs({ lang, items }: Props) {
  const t = (l: { en: string; ja: string }) => l[lang];
  const [active, setActive] = useState(items[0]?.engine.id ?? '');
  const list = useRef<HTMLDivElement>(null);
  const current = items.find((i) => i.engine.id === active) ?? items[0];
  if (!current) return null;

  const focusTab = (id: string) => {
    setActive(id);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus();
  };

  return (
    <div className="tabs">
      <div
        className="tablist"
        role="tablist"
        aria-label={t(UI.projHeading)}
        ref={list}
        onKeyDown={(e) => {
          const i = items.findIndex((x) => x.engine.id === current.engine.id);
          const go = (n: number) => {
            e.preventDefault();
            focusTab(items[(n + items.length) % items.length].engine.id);
          };
          if (e.key === 'ArrowRight') go(i + 1);
          else if (e.key === 'ArrowLeft') go(i - 1);
          else if (e.key === 'Home') go(0);
          else if (e.key === 'End') go(items.length - 1);
        }}
      >
        {items.map(({ engine }) => (
          <button
            key={engine.id}
            type="button"
            role="tab"
            id={`tab-${engine.id}`}
            data-tab={engine.id}
            aria-selected={engine.id === current.engine.id}
            // Only the selected tab's panel exists in the DOM.
            aria-controls={engine.id === current.engine.id ? `panel-${engine.id}` : undefined}
            tabIndex={engine.id === current.engine.id ? 0 : -1}
            onClick={() => setActive(engine.id)}
          >
            {engine.name}
          </button>
        ))}
      </div>

      <div
        className="tabpanel"
        role="tabpanel"
        id={`panel-${current.engine.id}`}
        aria-labelledby={`tab-${current.engine.id}`}
      >
        <p className="tab-about">
          {t(current.engine.paradigm)}. {t(current.engine.tagline)}
        </p>
        <div className="sources">
          {current.projection.sources.map((src) => {
            const body = (
              <>
                <Code src={src} empty={t(UI.emptyAtStage)} />
                {src.note && <p className="src-note">{t(src.note)}</p>}
              </>
            );
            return (
              <section className="src" key={src.label}>
                {src.code.length > BULKY ? (
                  <details>
                    <summary>
                      <span className="src-name">{src.label}</span>
                      <span className="src-lines">
                        {fill(t(UI.lineCount), src.code.split('\n').length)}
                      </span>
                    </summary>
                    {body}
                  </details>
                ) : (
                  <>
                    <h3 className="src-name">{src.label}</h3>
                    {body}
                  </>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
