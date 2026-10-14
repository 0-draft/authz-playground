import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, STEPS, enumerateRequests } from '../core/scenario';
import { buildPolicy, regoEngine, regoEvaluator } from './rego';

const requirements = STEPS.find((s) => s.id === 4)!.requirements;
const requests = enumerateRequests(DEFAULT_SCENARIO, [8, 9, 17, 18], [true]);

describe('the editable Rego policy', () => {
  it('evaluates the shipped text exactly as the engine does', async () => {
    // The editor starts from buildPolicy(…, lang) and compares against the engine's
    // own row. If the two drifted apart, an untouched policy would report changes.
    const engine = await regoEngine.prepare(DEFAULT_SCENARIO, requirements);
    for (const lang of ['en', 'ja'] as const) {
      const edited = regoEvaluator(DEFAULT_SCENARIO, buildPolicy(requirements, lang));
      for (const req of requests) {
        expect((await edited.decide(req)).decision).toBe((await engine.decide(req)).decision);
      }
    }
  });

  it('reports a policy OPA cannot compile as an error, not as a deny', async () => {
    const ev = regoEvaluator(DEFAULT_SCENARIO, 'package authz\n\nallow if {');
    const result = await ev.decide(requests[0]);
    expect(result.error).toBeTruthy();
  });

  it('decides with the edited rules', async () => {
    const policy = 'package authz\n\nallow if input.action == "delete"';
    const ev = regoEvaluator(DEFAULT_SCENARIO, policy);
    for (const req of requests) {
      expect((await ev.decide(req)).decision).toBe(req.action === 'delete' ? 'allow' : 'deny');
    }
  });
});
