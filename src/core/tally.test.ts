import { describe, expect, it } from 'vitest';
import { stageSummary, tallyState } from './tally';

describe('what the summary line may claim', () => {
  it('says nothing while rows are still being computed', () => {
    expect(tallyState(null, 5, 5)).toBe('evaluating');
    expect(tallyState(null, 4, 5)).toBe('evaluating');
  });

  it('never reports universal agreement while an engine is missing', () => {
    // Rego is absent for as long as its 8 MB gzipped module is downloading, and the
    // engines present can agree with each other for the whole of that window. Reporting
    // that as "every engine agrees" is a claim about a measurement never taken.
    expect(tallyState(0, 4, 5)).toBe('agree-partial');
    expect(tallyState(0, 1, 5)).toBe('agree-partial');
  });

  it('reports universal agreement only once every engine has reported', () => {
    expect(tallyState(0, 5, 5)).toBe('agree');
  });

  it('reports a disagreement as soon as one exists, however many engines are present', () => {
    expect(tallyState(8, 5, 5)).toBe('disagree');
    expect(tallyState(1, 4, 5)).toBe('disagree');
  });
});

describe('an even split has no minority', () => {
  // deriveOutcome charges a "break" to whichever side is outnumbered. With an even
  // split nobody is outnumbered, but the original ternary fell through to deny and
  // charged both denying engines. It cannot fire with five engines on this scenario,
  // which is exactly why it needs a test rather than an observation.
  const minorityOf = (votes: ('allow' | 'deny')[]): 'allow' | 'deny' | null => {
    const allows = votes.filter((v) => v === 'allow').length;
    const denies = votes.length - allows;
    if (allows === denies) return null;
    return allows < denies ? 'allow' : 'deny';
  };

  it('charges nobody when the vote is tied', () => {
    expect(minorityOf(['allow', 'allow', 'deny', 'deny'])).toBeNull();
  });

  it('charges the outnumbered side otherwise', () => {
    expect(minorityOf(['allow', 'deny', 'deny', 'deny'])).toBe('allow');
    expect(minorityOf(['allow', 'allow', 'allow', 'deny'])).toBe('deny');
  });
});

describe('what a stage in the stage bar may claim', () => {
  const clean = { clash: [false, false], breaks: { cedar: 0, rebac: 0 } };

  it('does not claim agreement while an engine is still loading', () => {
    // The stage bar used to print "all agree" for any stage whose rows were in, which
    // during the OPA download meant agreement among the engines that had loaded.
    expect(stageSummary(clean, 4, 5).state).toBe('agree-partial');
    expect(stageSummary(clean, 5, 5).state).toBe('agree');
    expect(stageSummary(null, 5, 5).state).toBe('evaluating');
  });

  it('reports an even split as a disagreement even though nobody is the outlier', () => {
    const evenSplit = { clash: [true, false], breaks: { cedar: 0, rebac: 0 } };
    const s = stageSummary(evenSplit, 4, 4);
    expect(s.state).toBe('disagree');
    expect(s.clashes).toBe(1);
    expect(s.outliers).toEqual([]);
  });

  it('names the engines in the minority', () => {
    const s = stageSummary({ clash: [true, true], breaks: { cedar: 0, rebac: 2 } }, 5, 5);
    expect(s.outliers).toEqual([['rebac', 2]]);
  });
});
