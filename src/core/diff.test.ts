import { describe, expect, it } from 'vitest';
import { runDifferential } from './diff';
import { DEFAULT_SCENARIO, STEPS, enumerateRequests } from './scenario';
import { cedarEngine } from '../engines/cedar';
import { casbinEngine } from '../engines/casbin';
import { regoEngine } from '../engines/rego';
import { rebacEngine } from '../engines/rebac';

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
      expect(report.divergences.map((d) => `${d.label} ${JSON.stringify(d.decisions)}`)).toEqual(
        [],
      );
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
