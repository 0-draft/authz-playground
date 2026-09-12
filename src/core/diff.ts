// The differential test harness.
// It projects one scenario and one set of requirements into every engine, runs every
// request the scenario can produce, and reports where the answers disagree.
// A disagreement has only two possible causes:
//   (a) a bug in the projection (the translation)  -> a defect to fix
//   (b) a genuine semantic difference between engines -> the teaching material itself
// Having this harness is what lets the project claim the comparison is fair.
import type { Decision } from './scenario';
import type { PolicyEngine } from './engine';
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
}

export async function runDifferential(
  engines: PolicyEngine[],
  scenario: Scenario,
  requirements: readonly string[],
  requests: AccessRequest[] = enumerateRequests(scenario),
): Promise<DiffReport> {
  const evaluators = await Promise.all(
    engines.map(async (e) => ({ id: e.meta.id, ev: await e.prepare(scenario, requirements) })),
  );

  const divergences: Divergence[] = [];
  const pairCounts = new Map<string, number>();

  for (const request of requests) {
    const decisions: Record<string, Decision> = {};
    for (const { id, ev } of evaluators) {
      decisions[id] = (await ev.decide(request)).decision;
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
  };
}
