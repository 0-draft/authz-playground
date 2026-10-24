import { describe, expect, it } from 'vitest';
import type { EngineResult } from './engine';
import { DAY_HOURS, minorityAt, splitHours } from './day';

const reason = { en: '', ja: '' };
const day = (allowed: (h: number) => boolean): EngineResult[] =>
  DAY_HOURS.map((h) => ({ decision: allowed(h) ? 'allow' : 'deny', reason }));
const broken: EngineResult[] = DAY_HOURS.map(() => ({
  decision: 'deny',
  reason,
  error: 'failed to prepare',
}));

describe('reading one question across the day', () => {
  const inHours = (h: number) => h >= 9 && h < 18;

  it('finds the hours where an engine without a clock dissents', () => {
    const results = { cedar: day(inHours), rego: day(inHours), rebac: day(() => true) };
    const split = splitHours(results);
    expect([...split].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21, 22, 23,
    ]);
    expect([...minorityAt(results, 8)]).toEqual(['rebac']);
    expect([...minorityAt(results, 10)]).toEqual([]);
  });

  it('does not count a failed engine’s deny as a vote', () => {
    // A broken engine answers deny at every hour. Counted, it would mark every hour in
    // business hours as a disagreement and make it look like the lone dissenter.
    const results = { cedar: day(inHours), rego: day(inHours), casbin: broken };
    expect(splitHours(results).size).toBe(0);
    expect(minorityAt(results, 10).size).toBe(0);
  });

  it('ignores engines that have not answered yet', () => {
    expect(splitHours({ cedar: day(inHours), rego: undefined }).size).toBe(0);
  });
});
