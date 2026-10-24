export type TallyState = 'evaluating' | 'agree-partial' | 'agree' | 'disagree';

/**
 * What the summary line is entitled to say.
 *
 * Two different things can make a clean result untrustworthy, and both have produced a
 * false claim on this page. Rows may not be computed yet, and an engine may be missing
 * from the comparison altogether while its module downloads. Agreement among three
 * engines is not agreement among every engine, so it must not be reported as one.
 */
export function tallyState(
  clashCount: number | null,
  enginesPresent: number,
  enginesTotal: number,
): TallyState {
  if (clashCount === null) return 'evaluating';
  if (clashCount > 0) return 'disagree';
  return enginesPresent < enginesTotal ? 'agree-partial' : 'agree';
}

export interface StageSummary {
  state: TallyState;
  /** Requests the engines disagree on, or null while any row is missing. */
  clashes: number | null;
  /** Engines in the minority at least once, with how often. Empty on an even split. */
  outliers: [string, number][];
}

/**
 * What a stage's entry in the stage bar may claim.
 *
 * It goes through tallyState for the same reason the summary line does: a stage whose
 * rows are all in can still be missing an engine that has not loaded, and an even
 * split charges nobody a break, so "no outliers" is not the same as "all agree".
 */
export function stageSummary(
  outcome: { clash: boolean[]; breaks: Record<string, number> } | null,
  enginesPresent: number,
  enginesTotal: number,
): StageSummary {
  const clashes = outcome ? outcome.clash.filter(Boolean).length : null;
  return {
    state: tallyState(clashes, enginesPresent, enginesTotal),
    clashes,
    outliers: outcome ? Object.entries(outcome.breaks).filter(([, n]) => n > 0) : [],
  };
}
