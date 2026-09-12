// The differential test harness.
// It projects one scenario and one set of requirements into every engine, runs every
// request the scenario can produce, and reports where the answers disagree.
// A disagreement has only two possible causes:
//   (a) a bug in the projection (the translation)  -> a defect to fix
//   (b) a genuine semantic difference between engines -> the teaching material itself
// Having this harness is what lets the project claim the comparison is fair.
import type { Decision } from './scenario';
import type { Evaluator, PolicyEngine } from './engine';
import type { AccessRequest, Scenario } from './scenario';
import { enumerateRequests, formatRequest } from './scenario';

export interface Divergence {
  request: AccessRequest;
  label: string;
  decisions: Record<string, Decision>;
  /** Engines that answered allow, and those that answered deny. */
  allowed: string[];
  denied: string[];
}

export interface DiffReport {
  engineIds: string[];
  totalRequests: number;
  divergences: Divergence[];
  /** Number of disagreements for each pair of engines. */
  disagreementPairs: { a: string; b: string; count: number }[];
  /**
   * Engine id -> the distinct failures it reported.
   *
   * An engine that fails on every request still answers deny, and deny happens to be
   * the correct answer for most requests, so a broken engine otherwise reads as a
   * well-behaved participant with few divergences. Failures are surfaced here so that
   * "no divergences" cannot be confused with "never ran".
   */
  errors: Record<string, string[]>;
}

/** Stands in for an engine whose prepare() threw, so one failure cannot abort the run. */
function brokenEvaluator(message: string): Evaluator {
  return {
    async decide() {
      return {
        decision: 'deny' as const,
        reason: { en: 'The engine failed to prepare', ja: 'エンジンの準備に失敗した' },
        error: message,
      };
    },
  };
}

export async function runDifferential(
  engines: PolicyEngine[],
  scenario: Scenario,
  requirements: readonly string[],
  requests: AccessRequest[] = enumerateRequests(scenario),
): Promise<DiffReport> {
  const errors: Record<string, string[]> = {};
  const noteError = (id: string, message: string) => {
    const seen = (errors[id] ??= []);
    if (!seen.includes(message)) seen.push(message);
  };

  const evaluators = await Promise.all(
    engines.map(async (e) => {
      try {
        return { id: e.meta.id, ev: await e.prepare(scenario, requirements) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        noteError(e.meta.id, `prepare failed: ${message}`);
        return { id: e.meta.id, ev: brokenEvaluator(message) };
      }
    }),
  );

  const divergences: Divergence[] = [];
  const pairCounts = new Map<string, number>();

  for (const request of requests) {
    const decisions: Record<string, Decision> = {};
    for (const { id, ev } of evaluators) {
      try {
        const result = await ev.decide(request);
        if (result.error) noteError(id, result.error);
        decisions[id] = result.decision;
      } catch (err) {
        noteError(id, err instanceof Error ? err.message : String(err));
        decisions[id] = 'deny';
      }
    }

    const values = new Set(Object.values(decisions));
    if (values.size > 1) {
      const allowed = Object.entries(decisions)
        .filter(([, d]) => d === 'allow')
        .map(([id]) => id);
      const denied = Object.entries(decisions)
        .filter(([, d]) => d === 'deny')
        .map(([id]) => id);
      divergences.push({ request, label: formatRequest(request), decisions, allowed, denied });

      for (const a of allowed) {
        for (const b of denied) {
          const key = [a, b].sort().join('|');
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    }
  }

  const disagreementPairs = [...pairCounts.entries()]
    .map(([key, count]) => {
      const [a, b] = key.split('|');
      return { a, b, count };
    })
    .sort((x, y) => y.count - x.count);

  return {
    engineIds: engines.map((e) => e.meta.id),
    totalRequests: requests.length,
    divergences,
    disagreementPairs,
    errors,
  };
}
