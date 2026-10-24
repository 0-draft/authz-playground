import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';
import { RequestMap } from './components/RequestMap';
import { DEFAULT_SCENARIO, enumerateRequests } from './core/scenario';
import { cedarEngine } from './engines/cedar';

describe('first paint', () => {
  it('reports that it is still evaluating, not that the engines agree', () => {
    // renderToStaticMarkup runs no effects, so this is exactly what a browser paints
    // before the sweep has produced a single row. Treating "not computed yet" as "no
    // disagreements" previously made the page assert that all 72 requests agreed, next
    // to an empty grid, on a stage where 8 of them do not.
    //
    // The assertion is on the state the summary line is in, not on its wording. An
    // earlier version of this test matched an English sentence, and rewording that
    // sentence silently disarmed it: the regression could be reintroduced with the
    // whole suite still green.
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('data-tally="evaluating"');
    expect(html).not.toContain('data-tally="agree"');
    expect(html).not.toContain('data-tally="agree-partial"');
    expect(html).not.toContain('data-tally="disagree"');
  });
});

describe('the request map', () => {
  it('renders when the question above is at an hour the map does not plot', () => {
    // The chart lets the hour go anywhere in 0-23 while the map only has 08, 09, 17 and
    // 18, so the selection is -1 most of the time. Reading the request at that index
    // threw and blanked the whole page the first time the chart was dragged.
    const requests = enumerateRequests(DEFAULT_SCENARIO, [8, 9, 17, 18]);
    const render = () =>
      renderToStaticMarkup(
        <RequestMap
          lang="en"
          engines={[cedarEngine.meta]}
          requests={requests}
          outcome={null}
          selected={-1}
          onSelect={() => {}}
        />,
      );
    expect(render).not.toThrow();
    expect(render()).not.toContain('data-sel="true"');
  });
});
