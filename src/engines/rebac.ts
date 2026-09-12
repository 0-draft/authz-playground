// A minimal implementation of the Zanzibar (OpenFGA) check algorithm.
// This is a teaching reimplementation rather than the real server, but the core
// — relation rewrites and tuple-to-userset traversal — has the same structure.
import type { Evaluator, PolicyEngine, Projection, RequirementSupport } from '../core/engine';
import { allow, deny } from '../core/engine';
import type { AccessRequest, Action, Scenario } from '../core/scenario';
import type { Lang } from '../i18n';

export interface Tuple {
  user: string;
  relation: string;
  object: string;
}

type Rewrite =
  /**
   * Holds if a direct tuple exists. `wildcard` mirrors OpenFGA's type restrictions:
   * `user:*` only grants the relation when the model declares `[user, user:*]`, so a
   * stray wildcard tuple written against `owner` does not silently make everyone owner.
   */
  | { kind: 'this'; wildcard?: boolean }
  /** Delegates to another relation on the same object. */
  | { kind: 'computed'; relation: string }
  /** Follows a tupleset and checks a relation on what it points at. The heart of Zanzibar. */
  | { kind: 'tupleToUserset'; tupleset: string; computedRelation: string };

function buildTuples(scenario: Scenario, requirements: readonly string[]): Tuple[] {
  const has = (r: string) => requirements.includes(r);
  const tuples: Tuple[] = [];

  for (const [doc, d] of Object.entries(scenario.documents)) {
    if (has('R1'))
      tuples.push({ user: `user:${d.owner}`, relation: 'owner', object: `document:${doc}` });
    if (has('R2'))
      tuples.push({ user: `folder:${d.folder}`, relation: 'parent', object: `document:${doc}` });
    // R4: "anyone" is expressed with a public wildcard tuple.
    if (has('R4') && d.isPublic) {
      tuples.push({ user: 'user:*', relation: 'viewer', object: `document:${doc}` });
    }
  }
  if (has('R2')) {
    for (const [folder, f] of Object.entries(scenario.folders)) {
      for (const admin of f.admins) {
        tuples.push({ user: `user:${admin}`, relation: 'admin', object: `folder:${folder}` });
      }
    }
  }
  return tuples;
}

function buildRewrites(requirements: readonly string[]): Record<string, Rewrite[]> {
  const has = (r: string) => requirements.includes(r);
  const editor: Rewrite[] = [];
  if (has('R1')) editor.push({ kind: 'computed', relation: 'owner' });
  if (has('R2'))
    editor.push({ kind: 'tupleToUserset', tupleset: 'parent', computedRelation: 'admin' });

  return {
    'document#owner': [{ kind: 'this' }],
    'document#parent': [{ kind: 'this' }],
    'document#editor': editor,
    // R4 grants viewing to anyone on a public document, and nothing more.
    // "Editors can also view" looks natural but is not in the requirements;
    // adding it would make this engine disagree with the other three.
    'document#viewer': has('R4') ? [{ kind: 'this', wildcard: true }] : [],
    'folder#admin': [{ kind: 'this' }],
  };
}

function buildDsl(requirements: readonly string[], lang: Lang): string {
  const has = (r: string) => requirements.includes(r);
  const editorParts: string[] = [];
  if (has('R1')) editorParts.push('owner');
  if (has('R2')) editorParts.push('admin from parent');

  const lines = ['model', '  schema 1.1', '', 'type user', ''];
  if (has('R2')) lines.push('type folder', '  relations', '    define admin: [user]', '');
  lines.push('type document', '  relations');
  if (has('R1')) lines.push('    define owner: [user]');
  if (has('R2')) lines.push('    define parent: [folder]');
  if (editorParts.length) lines.push(`    define editor: ${editorParts.join(' or ')}`);
  if (has('R4')) lines.push('    define viewer: [user, user:*]');
  if (has('R3')) {
    lines.push(
      '',
      lang === 'ja'
        ? '# R3 (営業時間のみ) を記述する手段は存在しない。'
        : '# There is no way to write R3 (business hours only) here.',
      lang === 'ja'
        ? '# このモデルに時刻という概念が無いためである。'
        : '# This model has no concept of time of day.',
    );
  }
  return lines.join('\n');
}

const MAX_DEPTH = 10;

function objectType(object: string): string {
  return object.split(':')[0];
}

/**
 * The Zanzibar check.
 * `trace` records the whole traversal; `path` records only the tuples that made
 * the decision hold, which is what the graph diagram highlights.
 */
function check(
  tuples: Tuple[],
  rewrites: Record<string, Rewrite[]>,
  user: string,
  relation: string,
  object: string,
  trace: string[],
  path: Tuple[],
  depth = 0,
): boolean {
  const indent = '  '.repeat(depth);
  trace.push(`${indent}check(${user}, ${relation}, ${object})`);
  if (depth > MAX_DEPTH) {
    // Unreachable in this model, whose deepest path is two hops. Marked rather than
    // returned as a plain deny so a cycle could never be mistaken for "not permitted".
    trace.push(`${indent}  aborted: exceeded ${MAX_DEPTH} levels of rewrite`);
    return false;
  }

  const rules = rewrites[`${objectType(object)}#${relation}`] ?? [];
  for (const rule of rules) {
    if (rule.kind === 'this') {
      const hit = tuples.find(
        (t) =>
          t.object === object &&
          t.relation === relation &&
          (t.user === user || (rule.wildcard === true && t.user === 'user:*')),
      );
      if (hit) {
        trace.push(`${indent}  match: ${hit.user} ${hit.relation} ${hit.object}`);
        path.push(hit);
        return true;
      }
    } else if (rule.kind === 'computed') {
      trace.push(`${indent}  ${relation} delegates to ${rule.relation}`);
      if (check(tuples, rewrites, user, rule.relation, object, trace, path, depth + 1)) return true;
    } else {
      // tuple-to-userset: follow the object's tupleset and re-check there.
      const parents = tuples.filter((t) => t.object === object && t.relation === rule.tupleset);
      for (const p of parents) {
        trace.push(`${indent}  follow ${rule.tupleset} to ${p.user}`);
        if (check(tuples, rewrites, user, rule.computedRelation, p.user, trace, path, depth + 1)) {
          path.push(p);
          return true;
        }
      }
    }
  }
  trace.push(`${indent}  no match`);
  return false;
}

/**
 * Actions map to relations one for one. Written as an exhaustive switch so that adding
 * an action to ACTIONS fails to compile instead of silently aliasing onto `deleter`,
 * which is what a trailing ternary did.
 */
export function actionToRelation(action: Action): string {
  switch (action) {
    case 'edit':
      return 'editor';
    case 'view':
      return 'viewer';
    case 'delete':
      return 'deleter';
  }
}

/** Test seam: the model as built, so a test can probe it with tuples of its own. */
export function rebacInternalsForTest(scenario: Scenario, requirements: readonly string[]) {
  return { tuples: buildTuples(scenario, requirements), rewrites: buildRewrites(requirements) };
}

/** Test seam: run one check against an arbitrary tuple set. */
export function checkForTest(
  tuples: Tuple[],
  rewrites: Record<string, Rewrite[]>,
  user: string,
  relation: string,
  object: string,
): boolean {
  return check(tuples, rewrites, user, relation, object, [], []);
}

/** Expose the tuples and the walked path so the graph diagram can be drawn. */
export function explainRebac(
  scenario: Scenario,
  requirements: readonly string[],
  req: AccessRequest,
) {
  const tuples = buildTuples(scenario, requirements);
  const rewrites = buildRewrites(requirements);
  const trace: string[] = [];
  const path: Tuple[] = [];
  const ok = check(
    tuples,
    rewrites,
    `user:${req.subject}`,
    actionToRelation(req.action),
    `document:${req.resource}`,
    trace,
    path,
  );
  return { ok, tuples, trace, path };
}

const SUPPORT: Record<string, RequirementSupport> = {
  R1: {
    level: 'native',
    note: {
      en: 'Ownership is a single tuple. Holding relationships as data is what this model assumes.',
      ja: 'owner はタプル1本で表現される。関係をデータとして保持することがこのモデルの前提である。',
    },
  },
  R2: {
    level: 'native',
    note: {
      en: 'This is tuple-to-userset (admin from parent) exactly, the shape Zanzibar is built for.',
      ja: 'tuple-to-userset (admin from parent) そのものであり、Zanzibar が最も得意とする形である。',
    },
  },
  R3: {
    level: 'impossible',
    note: {
      en: 'The model has no notion of request-time context. check(user, relation, object) has three arguments and none of them can carry a time. OpenFGA added Conditions years later to close exactly this gap.',
      ja: 'このモデルにはリクエスト時の context という概念が存在しない。check(user, relation, object) の3項に時刻を与える場所がない。OpenFGA が後年 Conditions を追加したのは、この欠落を補うためである。',
    },
  },
  R4: {
    level: 'native',
    note: {
      en: 'The public wildcard tuple user:* expresses "anyone".',
      ja: 'public wildcard タプル user:* により「誰でも」を表現できる。',
    },
  },
};

export const rebacEngine: PolicyEngine = {
  meta: {
    id: 'rebac',
    name: 'ReBAC (Zanzibar)',
    paradigm: {
      en: 'Relationship tuples plus rewrite rules, resolved by graph search',
      ja: '関係タプルと書き換え規則をグラフ探索で解決する方式',
    },
    year: 2019,
    origin: 'Google (paper) / OpenFGA',
    tagline: {
      en: 'Permission as reachability in a graph. The model behind sharing in Drive, Calendar, Photos and the rest of Google.',
      ja: '権限をグラフの到達可能性として解く方式。Drive や Calendar をはじめとする Google 各サービスの共有を支えるモデルである。',
    },
  },

  project(scenario: Scenario, requirements: readonly string[], lang: Lang): Projection {
    const tuples = buildTuples(scenario, requirements);
    return {
      sources: [
        {
          label: 'model.fga',
          lang: 'dsl',
          code: buildDsl(requirements, lang),
          note: {
            en: 'The model defines relations and nothing else. There is no place in the syntax to put a condition.',
            ja: 'モデルは関係の定義のみで構成される。条件式を記述する場所が文法上存在しない。',
          },
        },
        {
          label: 'tuples',
          lang: 'csv',
          code: tuples.map((t) => `${t.user}  ${t.relation}  ${t.object}`).join('\n'),
          note: {
            en: 'Adding a document leaves the model untouched and only adds tuples — the opposite of regenerating Casbin’s policy table.',
            ja: 'document が増えてもモデルは変更されず、タプルが追加されるだけである。Casbin のポリシー表を再生成する方式とは対照的である。',
          },
        },
      ],
      support: SUPPORT,
    };
  },

  async prepare(scenario: Scenario, requirements: readonly string[]): Promise<Evaluator> {
    const tuples = buildTuples(scenario, requirements);
    const rewrites = buildRewrites(requirements);

    return {
      async decide(req: AccessRequest) {
        // action maps to a relation. There is no parameter for context, so hour is dropped.
        const relation = actionToRelation(req.action);
        const trace: string[] = [];
        const ok = check(
          tuples,
          rewrites,
          `user:${req.subject}`,
          relation,
          `document:${req.resource}`,
          trace,
          [],
        );
        return ok
          ? allow(
              {
                en: `Graph search reached ${relation}`,
                ja: `グラフ探索により ${relation} に到達した`,
              },
              trace,
            )
          : deny(
              {
                en: `Graph search could not reach ${relation}`,
                ja: `グラフ探索では ${relation} に到達できなかった`,
              },
              trace,
            );
      },
    };
  },
};
