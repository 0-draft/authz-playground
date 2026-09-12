import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';

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
