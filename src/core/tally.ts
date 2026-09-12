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
