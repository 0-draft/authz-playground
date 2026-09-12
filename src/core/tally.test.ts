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
