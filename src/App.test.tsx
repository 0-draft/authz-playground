import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';

describe('first paint', () => {
  it('does not claim anything about agreement before evaluating', () => {
    // renderToStaticMarkup runs no effects, so this is exactly what a browser paints
    // before the sweep has produced a single row. Treating "not computed yet" as
    // "no disagreements" previously made the page assert that all 72 requests agreed,
    // next to an empty grid, on a stage where 8 of them genuinely do not.
    const html = renderToStaticMarkup(<App />);
    expect(html).not.toContain('agree across every engine');
    expect(html).not.toContain('requests get different answers');
  });
});
