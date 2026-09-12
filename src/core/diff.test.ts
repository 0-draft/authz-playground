import { describe, expect, it } from 'vitest';
import { runDifferential } from './diff';
import { DEFAULT_SCENARIO, STEPS, enumerateRequests, formatRequest } from './scenario';
import type { PolicyEngine } from './engine';
import { expectedDecision } from './oracle';
import { cedarEngine } from '../engines/cedar';
import { casbinEngine } from '../engines/casbin';
import { regoEngine } from '../engines/rego';
import { checkForTest, rebacEngine, rebacInternalsForTest } from '../engines/rebac';

const ALL = [cedarEngine, regoEngine, casbinEngine, rebacEngine];
/** Engines that can express request context. These must agree with each other exactly. */
const CONTEXT_CAPABLE = [cedarEngine, regoEngine, casbinEngine];

const step = (id: number) => STEPS.find((s) => s.id === id)!.requirements;

describe('fidelity of the projections', () => {
  // If engines from different paradigms produce the same answers, the translation
  // can be trusted. If this breaks, the whole comparison is a lie, so it is the
  // invariant guarded most closely.
  for (const s of STEPS) {
    it(`stage ${s.id} (${s.title.en}): the three context-capable engines agree exactly`, async () => {
      const report = await runDifferential(CONTEXT_CAPABLE, DEFAULT_SCENARIO, s.requirements);
      expect(report.totalRequests).toBeGreaterThan(0);
      expect(report.errors).toEqual({});
      expect(report.divergences.map((d) => `${d.label} ${JSON.stringify(d.decisions)}`)).toEqual(
        [],
      );
    });
  }
});

describe('the business-hours boundary', () => {
  // Agreement between engines is not enough to pin R3 down. Unless both edges of the
  // window are actually evaluated, a projection can encode 08:00-19:00 instead of
  // 09:00-18:00 and still agree with the others on every sampled request. These tests
  // state the window directly, so a wrong edge fails here rather than passing silently.
  const OWNER = 'alice';
  const DOC = 'design-doc';

  for (const engine of CONTEXT_CAPABLE) {
    it(`${engine.meta.name} allows editing exactly within 09:00-17:59`, async () => {
      const ev = await engine.prepare(DEFAULT_SCENARIO, step(3));
      const at = async (hour: number) =>
        (
          await ev.decide({
            subject: OWNER,
            action: 'edit',
            resource: DOC,
            context: { hour, mfa: true },
          })
        ).decision;

      expect(await at(8), 'the hour before opening must be denied').toBe('deny');
      expect(await at(9), 'the opening hour must be allowed').toBe('allow');
      expect(await at(17), 'the last hour of the window must be allowed').toBe('allow');
      expect(await at(18), 'the closing hour must be denied').toBe('deny');
    });
  }

  it('the enumeration actually samples both edges', async () => {
    // Guards the guard: if BOUNDARY_HOURS ever loses an edge, the tests above still
    // pass but the differential sweep goes blind again.
    const hours = new Set(enumerateRequests(DEFAULT_SCENARIO).map((r) => r.context.hour));
    for (const h of [8, 9, 17, 18]) expect(hours.has(h), `hour ${h} must be sampled`).toBe(true);
  });
});

describe('every engine matches an independent reading of the requirements', () => {
  // Agreement between engines only proves they made the same choice, not the right one.
  // A misreading shared by all four — "the owner may also view", say — would be
  // invisible to the differential harness. This checks each engine against a second
  // implementation written from the requirement text alone.
  //
  // The single exception is ReBAC once R3 is in play: it has no way to express a time
  // window, so disagreeing there is the structural limitation the project is about.
  for (const engine of ALL) {
    for (const s of STEPS) {
      const rebacCannotExpressR3 = engine.meta.id === 'rebac' && s.requirements.includes('R3');

      it(`${engine.meta.name} at stage ${s.id}${rebacCannotExpressR3 ? ' (outside business hours excepted)' : ''}`, async () => {
        const ev = await engine.prepare(DEFAULT_SCENARIO, s.requirements);
        const wrong: string[] = [];

        for (const req of enumerateRequests(DEFAULT_SCENARIO)) {
          const expected = expectedDecision(DEFAULT_SCENARIO, s.requirements, req);
          const actual = (await ev.decide(req)).decision;
          if (actual === expected) continue;

          const outsideHours = req.context.hour < 9 || req.context.hour >= 18;
          const isTheKnownLimit =
            rebacCannotExpressR3 &&
            req.action === 'edit' &&
            outsideHours &&
            actual === 'allow' &&
            expected === 'deny';
          if (!isTheKnownLimit) {
            wrong.push(`${formatRequest(req)}: expected ${expected}, got ${actual}`);
          }
        }

        expect(wrong).toEqual([]);
      });
    }
  }
});

describe('every reachable requirement combination', () => {
  // STEPS is strictly cumulative, so only 4 of the 15 non-empty combinations were ever
  // exercised: R2 was never tested without R1, R4 never without R3, R3 never alone.
  // Each engine builder is a set of independent has('Rn') branches, so all 15 are
  // reachable states of the API, and it was one of the unreached ones that hid the
  // Casbin empty-policy crash.
  const ALL_REQUIREMENTS = ['R1', 'R2', 'R3', 'R4'];
  const combinations: string[][] = [];
  for (let mask = 1; mask < 1 << ALL_REQUIREMENTS.length; mask++) {
    combinations.push(ALL_REQUIREMENTS.filter((_, i) => mask & (1 << i)));
  }

  it(`covers all ${combinations.length} combinations`, () => {
    expect(combinations).toHaveLength(15);
  });

  for (const engine of ALL) {
    it(`${engine.meta.name} matches the oracle in every combination`, async () => {
      const wrong: string[] = [];

      for (const requirements of combinations) {
        const ev = await engine.prepare(DEFAULT_SCENARIO, requirements);
        const rebacCannotExpressR3 = engine.meta.id === 'rebac' && requirements.includes('R3');

        for (const req of enumerateRequests(DEFAULT_SCENARIO)) {
          const res = await ev.decide(req);
          if (res.error) {
            wrong.push(`[${requirements.join('+')}] ${formatRequest(req)}: ${res.error}`);
            continue;
          }
          const expected = expectedDecision(DEFAULT_SCENARIO, requirements, req);
          if (res.decision === expected) continue;

          const outsideHours = req.context.hour < 9 || req.context.hour >= 18;
          const isTheKnownLimit =
            rebacCannotExpressR3 &&
            req.action === 'edit' &&
            outsideHours &&
            res.decision === 'allow' &&
            expected === 'deny';
          if (!isTheKnownLimit) {
            wrong.push(
              `[${requirements.join('+')}] ${formatRequest(req)}: expected ${expected}, got ${res.decision}`,
            );
          }
        }
      }

      expect(wrong.slice(0, 10)).toEqual([]);
    });
  }
});

describe('detecting structural limits', () => {
  it('through stage 2 every engine agrees, ReBAC included', async () => {
    const report = await runDifferential(ALL, DEFAULT_SCENARIO, step(2));
    expect(report.divergences).toEqual([]);
  });

  it('at stage 3 only ReBAC diverges, because it has no concept of context', async () => {
    const report = await runDifferential(ALL, DEFAULT_SCENARIO, step(3));

    expect(report.divergences.length).toBeGreaterThan(0);
    // In every divergence, ReBAC is alone on the allow side.
    for (const d of report.divergences) {
      expect(d.allowed).toEqual(['rebac']);
      expect(d.denied.sort()).toEqual(['casbin', 'cedar', 'rego']);
    }
  });

  it('the only divergences are edits outside business hours', async () => {
    const report = await runDifferential(ALL, DEFAULT_SCENARIO, step(3));
    for (const d of report.divergences) {
      expect(d.request.action).toBe('edit');
      const h = d.request.context.hour;
      expect(h < 9 || h >= 18).toBe(true);
    }
  });

  it('stage 4 adds a requirement without adding new causes of divergence', async () => {
    // Giving ReBAC's viewer relation an "editors can view too" rewrite looks natural
    // but grants access the requirements never asked for, which doubles the
    // disagreements. This guards against that kind of helpful mistranslation.
    const s3 = await runDifferential(ALL, DEFAULT_SCENARIO, step(3));
    const s4 = await runDifferential(ALL, DEFAULT_SCENARIO, step(4));

    expect(s4.divergences.length).toBe(s3.divergences.length);
    for (const d of s4.divergences) {
      expect(d.request.action).toBe('edit');
      expect(d.allowed).toEqual(['rebac']);
    }
  });

  it('ReBAC declares R3 inexpressible, and the measured divergences agree', async () => {
    const support = rebacEngine.project(DEFAULT_SCENARIO, step(3), 'en').support;
    expect(support.R3.level).toBe('impossible');

    // The declared metadata and the measured behaviour must not contradict each other.
    const report = await runDifferential(ALL, DEFAULT_SCENARIO, step(3));
    expect(report.disagreementPairs.every((p) => p.a === 'rebac' || p.b === 'rebac')).toBe(true);
  });
});

describe('every engine can evaluate', () => {
  for (const engine of ALL) {
    it(`${engine.meta.name} evaluates every stage 4 request without error`, async () => {
      const ev = await engine.prepare(DEFAULT_SCENARIO, step(4));
      const requests = enumerateRequests(DEFAULT_SCENARIO);
      for (const req of requests) {
        const res = await ev.decide(req);
        expect(res.error, `${engine.meta.id}: ${res.error}`).toBeUndefined();
        expect(['allow', 'deny']).toContain(res.decision);
      }
    });
  }
});

describe('ReBAC honours the type restrictions its model declares', () => {
  it('a public wildcard only grants the relation the model opens to it', async () => {
    // OpenFGA scopes `user:*` per relation: it grants viewer because the model says
    // `viewer: [user, user:*]`, and must not grant owner, which is declared `[user]`.
    const { tuples, rewrites } = rebacInternalsForTest(DEFAULT_SCENARIO, step(4));
    const wildcardOnOwner = [
      ...tuples,
      { user: 'user:*', relation: 'owner', object: 'document:design-doc' },
    ];

    expect(
      checkForTest(wildcardOnOwner, rewrites, 'user:mallory', 'owner', 'document:design-doc'),
      'a stray wildcard on owner must not make everyone the owner',
    ).toBe(false);

    // The declared one still works: postmortem is public, so anyone may view it.
    expect(checkForTest(tuples, rewrites, 'user:mallory', 'viewer', 'document:postmortem')).toBe(
      true,
    );
  });
});

describe('the harness reports failure instead of hiding it', () => {
  it('every engine projects a requirement set that grants nothing', async () => {
    // R3 on its own only restricts; it grants no access. Casbin used to throw here
    // because node-casbin rejects an empty policy document, which made one engine
    // unprojectable for an input the other three handle by denying everything.
    for (const engine of ALL) {
      const ev = await engine.prepare(DEFAULT_SCENARIO, ['R3']);
      const res = await ev.decide({
        subject: 'alice',
        action: 'edit',
        resource: 'design-doc',
        context: { hour: 10, mfa: true },
      });
      expect(res.error, `${engine.meta.id}: ${res.error}`).toBeUndefined();
      expect(res.decision, `${engine.meta.id} should grant nothing`).toBe('deny');
    }
  });

  it('a failing engine is recorded rather than passed off as a denier', async () => {
    // A broken engine answers deny for everything, and deny is the correct answer for
    // most requests, so without this it would look like a well-behaved participant.
    const broken: PolicyEngine = {
      meta: { ...rebacEngine.meta, id: 'broken', name: 'Broken' },
      project: rebacEngine.project,
      prepare: async () => {
        throw new Error('projection unavailable');
      },
    };

    const report = await runDifferential([cedarEngine, broken], DEFAULT_SCENARIO, step(4));

    expect(report.errors.broken).toContain('prepare failed: projection unavailable');
    expect(report.totalRequests).toBeGreaterThan(0); // the run completed rather than aborting
  });
});

describe('the requirements are actually met', () => {
  it('Cedar returns the expected decisions at stage 4', async () => {
    const ev = await cedarEngine.prepare(DEFAULT_SCENARIO, step(4));
    const ctx = { hour: 10, mfa: true };
    const decide = (subject: string, action: 'view' | 'edit', resource: string, hour = 10) =>
      ev.decide({ subject, action, resource, context: { ...ctx, hour } }).then((r) => r.decision);

    // R1: the owner
    await expect(decide('alice', 'edit', 'design-doc')).resolves.toBe('allow');
    // R2: an admin of the containing folder
    await expect(decide('bob', 'edit', 'design-doc')).resolves.toBe('allow');
    // an unrelated user
    await expect(decide('carol', 'edit', 'design-doc')).resolves.toBe('deny');
    // R3: outside business hours
    await expect(decide('alice', 'edit', 'design-doc', 3)).resolves.toBe('deny');
    // R4: anyone may view a public document
    await expect(decide('carol', 'view', 'postmortem')).resolves.toBe('allow');
    // a non-public document stays unreadable
    await expect(decide('bob', 'view', 'design-doc')).resolves.toBe('deny');
  });
});
