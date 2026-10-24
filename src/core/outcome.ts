// Comparing the engines' rows for one stage.
import type { Decision } from './scenario';

export interface MapOutcome {
  /** engine id -> the decision for each request, in request order */
  decisions: Record<string, Decision[]>;
  /** whether the engines disagreed, per request */
  clash: boolean[];
  /** the engines in the minority, per request; empty when agreed or evenly split */
  minority: string[][];
}

export interface StepOutcome extends MapOutcome {
  /** engine id -> how many times it was in the minority */
  breaks: Record<string, number>;
}

export const rowKey = (stepId: number, engineId: string) => `${stepId}:${engineId}`;

/**
 * Derive the comparison for one stage, or null while any engine's row is still
 * missing. Returning null matters: treating "not computed yet" as "no disagreement"
 * would make the page claim every engine agrees before it has evaluated anything.
 *
 * `engineIds` must not include an engine that failed. Its row never arrives, so
 * including it held the whole page at "evaluating" for good, next to a notice that
 * already said the engine was gone.
 */
export function deriveOutcome(
  rows: Record<string, Decision[]>,
  stepId: number,
  engineIds: readonly string[],
): StepOutcome | null {
  const decisions: Record<string, Decision[]> = {};
  for (const id of engineIds) {
    const row = rows[rowKey(stepId, id)];
    if (!row) return null;
    decisions[id] = row;
  }
  if (engineIds.length === 0) return null;

  const count = decisions[engineIds[0]].length;
  const clash: boolean[] = [];
  const minority: string[][] = [];
  const breaks: Record<string, number> = Object.fromEntries(engineIds.map((id) => [id, 0]));

  for (let i = 0; i < count; i++) {
    const votes = engineIds.map((id) => decisions[id][i]);
    const allows = votes.filter((v) => v === 'allow').length;
    const denies = votes.length - allows;
    clash.push(allows > 0 && denies > 0);
    // An even split has no minority, so nobody is charged a break for it.
    const odd: string[] = [];
    if (allows > 0 && denies > 0 && allows !== denies) {
      const side: Decision = allows < denies ? 'allow' : 'deny';
      engineIds.forEach((id, k) => {
        if (votes[k] === side) {
          odd.push(id);
          breaks[id] += 1;
        }
      });
    }
    minority.push(odd);
  }

  return { decisions, clash, minority, breaks };
}
