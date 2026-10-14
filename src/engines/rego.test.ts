import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, STEPS, enumerateRequests } from '../core/scenario';
import { buildPolicy, regoEngine, regoEvaluator } from './rego';

const requests = enumerateRequests(DEFAULT_SCENARIO);

describe('the editable Rego policy', () => {
  it('evaluates the shipped text exactly as the engine does', async () => {
    // The editor starts from buildPolicy(…, lang) and compares against the engine's
    // own row. If the two drifted apart, an untouched policy would report changes.
    for (const step of STEPS) {
      const engine = await regoEngine.prepare(DEFAULT_SCENARIO, step.requirements);
      for (const lang of ['en', 'ja'] as const) {
        const edited = regoEvaluator(DEFAULT_SCENARIO, buildPolicy(step.requirements, lang));
        for (const req of requests) {
          expect((await edited.decide(req)).decision).toBe((await engine.decide(req)).decision);
        }
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
