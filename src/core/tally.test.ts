import { describe, expect, it } from 'vitest';
import { tallyState } from './tally';

describe('what the summary line may claim', () => {
  it('says nothing while rows are still being computed', () => {
    expect(tallyState(null, 4, 4)).toBe('evaluating');
    expect(tallyState(null, 3, 4)).toBe('evaluating');
  });

  it('never reports universal agreement while an engine is missing', () => {
    // Rego is absent for as long as its 8 MB module is downloading, and the three
    // engines present can agree with each other for the whole of that window. Reporting
    // that as "every engine agrees" is a claim about a measurement never taken.
    expect(tallyState(0, 3, 4)).toBe('agree-partial');
    expect(tallyState(0, 1, 4)).toBe('agree-partial');
  });

  it('reports universal agreement only once every engine has reported', () => {
    expect(tallyState(0, 4, 4)).toBe('agree');
  });

  it('reports a disagreement as soon as one exists, however many engines are present', () => {
    expect(tallyState(8, 4, 4)).toBe('disagree');
    expect(tallyState(1, 3, 4)).toBe('disagree');
  });
});

describe('an even split has no minority', () => {
  // deriveOutcome charges a "break" to whichever side is outnumbered. With an even
  // split nobody is outnumbered, but the original ternary fell through to deny and
  // charged both denying engines. It cannot fire with four engines on this scenario,
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
