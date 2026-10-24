// A minimal implementation of the Zanzibar (OpenFGA) check algorithm.
// This is a teaching reimplementation rather than the real server, but the core
// — relation rewrites and tuple-to-userset traversal — has the same structure.
//
// Two engines are built from it. The classic one has only what the 2019 paper has, and
// cannot write R3. The second adds OpenFGA's conditional tuples and the `and` operator,
// which is how the same model expresses R3 today: the relationships still grant the
// edit, and a condition evaluated against the request context gates it.
import type { Evaluator, PolicyEngine, Projection, RequirementSupport } from '../core/engine';
import { allow, deny } from '../core/engine';
import type { AccessRequest, Action, RequestContext, Scenario } from '../core/scenario';
import type { Lang } from '../i18n';

export interface Tuple {
  user: string;
  relation: string;
  object: string;
  /** Name of the condition the tuple is written with. It only holds when that condition does. */
  condition?: string;
}

/** A named CEL-style predicate over the request context, as OpenFGA declares one. */
export interface Condition {
  name: string;
  /** The parameter list exactly as the DSL prints it. */
  params: string;
  /** The body exactly as the DSL prints it. */
  expression: string;
  holds(ctx: RequestContext): boolean;
}

export const BUSINESS_HOURS: Condition = {
  name: 'business_hours',
  params: 'hour: int',
  expression: 'hour >= 9 && hour < 18',
  holds: (ctx) => ctx.hour >= 9 && ctx.hour < 18,
};

/** Which flavour of the model to build. */
export type Variant = 'classic' | 'conditions';

export type Rewrite =
  /**
   * Holds if a direct tuple exists. `wildcard` mirrors OpenFGA's type restrictions:
   * `user:*` only grants the relation when the model declares `[user, user:*]`, so a
   * stray wildcard tuple written against `owner` does not silently make everyone owner.
   */
  | { kind: 'this'; wildcard?: boolean }
  /** Delegates to another relation on the same object. */
  | { kind: 'computed'; relation: string }
  /** Follows a tupleset and checks a relation on what it points at. The heart of Zanzibar. */
  | { kind: 'tupleToUserset'; tupleset: string; computedRelation: string }
  /**
   * Holds only if every child does. Each child is itself a union, so
   * `(owner or admin from parent) and within_hours` is two children.
   */
  | { kind: 'intersection'; children: Rewrite[][] };

/** Whether the conditions variant gates editing with a condition at these requirements. */
function gatesEditing(variant: Variant, requirements: readonly string[]): boolean {
  const has = (r: string) => requirements.includes(r);
  // R3 restricts editing, so with nothing granting an edit there is nothing to gate.
  return variant === 'conditions' && has('R3') && (has('R1') || has('R2'));
}

function buildTuples(
  scenario: Scenario,
  requirements: readonly string[],
  variant: Variant = 'classic',
): Tuple[] {
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
    // R3: one wildcard tuple per document, written with the condition. The relationships
    // above stay unconditional; this is the attribute layer laid on top of them.
    if (gatesEditing(variant, requirements)) {
      tuples.push({
        user: 'user:*',
        relation: 'within_hours',
        object: `document:${doc}`,
        condition: BUSINESS_HOURS.name,
      });
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

function buildRewrites(
  requirements: readonly string[],
  variant: Variant = 'classic',
): Record<string, Rewrite[]> {
  const has = (r: string) => requirements.includes(r);
  const grants: Rewrite[] = [];
  if (has('R1')) grants.push({ kind: 'computed', relation: 'owner' });
  if (has('R2'))
    grants.push({ kind: 'tupleToUserset', tupleset: 'parent', computedRelation: 'admin' });

  const editor: Rewrite[] = gatesEditing(variant, requirements)
    ? [
        {
          kind: 'intersection',
          children: [grants, [{ kind: 'computed', relation: 'within_hours' }]],
        },
      ]
    : grants;

  return {
    'document#owner': [{ kind: 'this' }],
    'document#parent': [{ kind: 'this' }],
    'document#within_hours': [{ kind: 'this', wildcard: true }],
    'document#editor': editor,
    // R4 grants viewing to anyone on a public document, and nothing more.
    // "Editors can also view" looks natural but is not in the requirements;
    // adding it would make this engine disagree with all the others.
    'document#viewer': has('R4') ? [{ kind: 'this', wildcard: true }] : [],
    'folder#admin': [{ kind: 'this' }],
  };
}

function buildDsl(requirements: readonly string[], lang: Lang, variant: Variant): string {
  const has = (r: string) => requirements.includes(r);
  const gated = gatesEditing(variant, requirements);
  const editorParts: string[] = [];
  if (has('R1')) editorParts.push('owner');
  if (has('R2')) editorParts.push('admin from parent');
  const grants = editorParts.join(' or ');
  const editor = gated
    ? `${editorParts.length > 1 ? `(${grants})` : grants} and within_hours`
    : grants;

  const lines = ['model', '  schema 1.1', '', 'type user', ''];
  if (has('R2')) lines.push('type folder', '  relations', '    define admin: [user]', '');
  // A `relations` header with nothing under it is not valid, and R3 alone produces
  // exactly that: it restricts without granting anything.
  const documentRelations = has('R1') || has('R2') || editorParts.length > 0 || has('R4');
  lines.push('type document');
  if (documentRelations) lines.push('  relations');
  if (has('R1')) lines.push('    define owner: [user]');
  if (has('R2')) lines.push('    define parent: [folder]');
  if (gated) lines.push(`    define within_hours: [user:* with ${BUSINESS_HOURS.name}]`);
  if (editorParts.length) lines.push(`    define editor: ${editor}`);
  if (has('R4')) lines.push('    define viewer: [user, user:*]');
  if (gated) {
    lines.push(
      '',
      `condition ${BUSINESS_HOURS.name}(${BUSINESS_HOURS.params}) {`,
      `  ${BUSINESS_HOURS.expression}`,
      '}',
    );
  } else if (has('R3') && variant === 'classic') {
    lines.push(
      '',
      lang === 'ja'
        ? '# 古典的な Zanzibar のモデルには R3 (営業時間のみ) を記述する手段が無い。'
        : '# The classic Zanzibar model has no way to write R3 (business hours only).',
      lang === 'ja'
        ? '# 関係の定義しか書けず、時刻を与える場所が存在しないためである。'
        : '# It defines relations and nothing else, with nowhere to put a time of day.',
      lang === 'ja'
        ? '# OpenFGA はまさにこの穴を埋めるため、後年 condition ブロックを追加した。'
        : '# OpenFGA added condition blocks years later to close exactly this gap.',
    );
  }
  return lines.join('\n');
}

export const MAX_DEPTH = 10;

function objectType(object: string): string {
  return object.split(':')[0];
}

/** Why a check stopped without an answer. Present only when it did. */
interface Abort {
  hit: boolean;
  reason?: string;
}

/** Everything a check reads or writes besides the user, relation and object in question. */
interface Walk {
  tuples: Tuple[];
  rewrites: Record<string, Rewrite[]>;
  /** The request context. Absent for the classic model, which has nowhere to put it. */
  context?: RequestContext;
  conditions: Record<string, Condition>;
  trace: string[];
  abort: Abort;
  /** Conditions that evaluated false along the way, so a deny can say what vetoed it. */
  vetoed: Set<string>;
}

/**
 * The Zanzibar check.
 * `trace` records the whole traversal; `path` records only the tuples that made
 * the decision hold, which is what the graph diagram highlights.
 */
function check(
  w: Walk,
  user: string,
  relation: string,
  object: string,
  path: Tuple[],
  depth = 0,
): boolean {
  const indent = '  '.repeat(depth);
  w.trace.push(`${indent}check(${user}, ${relation}, ${object})`);
  if (depth > MAX_DEPTH) {
    // Unreachable in this model, whose deepest path is two hops. Recorded rather than
    // returned as a plain deny so a cycle could never be mistaken for "not permitted":
    // the caller turns this into a reported error instead of a decision.
    w.trace.push(`${indent}  aborted: exceeded ${MAX_DEPTH} levels of rewrite`);
    w.abort.hit = true;
    w.abort.reason = `rewrite depth exceeded ${MAX_DEPTH}`;
    return false;
  }

  const rules = w.rewrites[`${objectType(object)}#${relation}`] ?? [];
  if (union(w, rules, user, relation, object, path, depth)) return true;
  w.trace.push(`${indent}  no match`);
  return false;
}

/** Holds if any rule does. A relation's rewrite list is read this way. */
function union(
  w: Walk,
  rules: Rewrite[],
  user: string,
  relation: string,
  object: string,
  path: Tuple[],
  depth: number,
): boolean {
  const indent = '  '.repeat(depth);
  for (const rule of rules) {
    if (w.abort.hit) return false;
    if (rule.kind === 'this') {
      const candidates = w.tuples.filter(
        (t) =>
          t.object === object &&
          t.relation === relation &&
          (t.user === user || (rule.wildcard === true && t.user === 'user:*')),
      );
      for (const hit of candidates) {
        w.trace.push(`${indent}  match: ${hit.user} ${hit.relation} ${hit.object}`);
        if (hit.condition && !conditionHolds(w, hit.condition, indent)) continue;
        path.push(hit);
        return true;
      }
    } else if (rule.kind === 'computed') {
      w.trace.push(`${indent}  ${relation} delegates to ${rule.relation}`);
      if (check(w, user, rule.relation, object, path, depth + 1)) return true;
    } else if (rule.kind === 'intersection') {
      // The path is kept only if every part holds, so a grant the condition then vetoes
      // is not drawn as the route the decision took.
      const found: Tuple[] = [];
      const all = rule.children.every((child, i) => {
        w.trace.push(`${indent}  and (${i + 1} of ${rule.children.length})`);
        return union(w, child, user, relation, object, found, depth + 1);
      });
      if (all) {
        path.push(...found);
        return true;
      }
    } else {
      // tuple-to-userset: follow the object's tupleset and re-check there.
      const parents = w.tuples.filter((t) => t.object === object && t.relation === rule.tupleset);
      for (const p of parents) {
        w.trace.push(`${indent}  follow ${rule.tupleset} to ${p.user}`);
        if (check(w, user, rule.computedRelation, p.user, path, depth + 1)) {
          path.push(p);
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Evaluate the condition a tuple was written with.
 *
 * A conditional tuple is only half a fact. Like OpenFGA, this refuses to guess when the
 * condition is undeclared or the context it needs was not supplied: the check aborts
 * with an error rather than quietly treating the tuple as absent.
 */
function conditionHolds(w: Walk, name: string, indent: string): boolean {
  const cond = w.conditions[name];
  if (!cond || !w.context) {
    w.trace.push(`${indent}  condition ${name} cannot be evaluated`);
    w.abort.hit = true;
    w.abort.reason = cond
      ? `condition ${name} needs request context`
      : `condition ${name} is not declared`;
    return false;
  }
  const ok = cond.holds(w.context);
  w.trace.push(`${indent}  condition ${name}(hour: ${w.context.hour}) is ${ok}`);
  if (!ok) w.vetoed.add(name);
  return ok;
}

const CONDITIONS: Record<string, Condition> = { [BUSINESS_HOURS.name]: BUSINESS_HOURS };

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
export function rebacInternalsForTest(
  scenario: Scenario,
  requirements: readonly string[],
  variant: Variant = 'classic',
) {
  return {
    tuples: buildTuples(scenario, requirements, variant),
    rewrites: buildRewrites(requirements, variant),
  };
}

/** Test seam: run one check against an arbitrary tuple set. */
export function checkForTest(
  tuples: Tuple[],
  rewrites: Record<string, Rewrite[]>,
  user: string,
  relation: string,
  object: string,
  context?: RequestContext,
): { ok: boolean; aborted: boolean; reason?: string; trace: string[] } {
  const w: Walk = {
    tuples,
    rewrites,
    context,
    conditions: CONDITIONS,
    trace: [],
    abort: { hit: false },
    vetoed: new Set(),
  };
  const ok = check(w, user, relation, object, []);
  return { ok, aborted: w.abort.hit, reason: w.abort.reason, trace: w.trace };
}

/** Expose the tuples and the walked path so the graph diagram can be drawn. */
export function explainRebac(
  scenario: Scenario,
  requirements: readonly string[],
  req: AccessRequest,
  variant: Variant = 'classic',
) {
  const tuples = buildTuples(scenario, requirements, variant);
  const w: Walk = {
    tuples,
    rewrites: buildRewrites(requirements, variant),
    context: variant === 'conditions' ? req.context : undefined,
    conditions: CONDITIONS,
    trace: [],
    abort: { hit: false },
    vetoed: new Set(),
  };
  const path: Tuple[] = [];
  const ok = check(
    w,
    `user:${req.subject}`,
    actionToRelation(req.action),
    `document:${req.resource}`,
    path,
  );
  return { ok, tuples, trace: w.trace, path };
}

const SHARED_SUPPORT: Record<'R1' | 'R2' | 'R4', RequirementSupport> = {
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
  R4: {
    level: 'native',
    note: {
      en: 'The public wildcard tuple user:* expresses "anyone".',
      ja: 'public wildcard タプル user:* により「誰でも」を表現できる。',
    },
  },
};

const SUPPORT: Record<string, RequirementSupport> = {
  ...SHARED_SUPPORT,
  R3: {
    level: 'impossible',
    note: {
      en: 'The model has no notion of request-time context. check(user, relation, object) has three arguments and none of them can carry a time. OpenFGA added Conditions years later to close exactly this gap.',
      ja: 'このモデルにはリクエスト時の context という概念が存在しない。check(user, relation, object) の3項に時刻を与える場所がない。OpenFGA が後年 Conditions を追加したのは、この欠落を補うためである。',
    },
  },
};

const CONDITIONS_SUPPORT: Record<string, RequirementSupport> = {
  ...SHARED_SUPPORT,
  R3: {
    level: 'native',
    note: {
      en: 'The relationships still decide who may edit; a condition decides when. One wildcard tuple per document carries business_hours, check() takes the request context as a fourth argument, and `and` joins the two. OpenFGA enabled this in v1.4 (2023); SpiceDB had already shipped it as experimental caveats in v1.14 (2022).',
      ja: '誰が編集できるかは引き続き関係が決め、いつ編集できるかを condition が決める。document ごとに business_hours 付きの wildcard タプルを1本置き、check() はリクエストの context を第4引数として受け取り、`and` で両者を結ぶ。OpenFGA は v1.4 (2023年) でこれを既定で有効にした。SpiceDB はそれより早く v1.14 (2022年) で同じ仕組みを実験的な caveat として出している。',
    },
  },
};

/**
 * Builds the evaluator for a model. Exported so a test can drive the real decide() with
 * a model the shipped scenario cannot produce — a cycle, for instance. Reaching past
 * decide() into check() would leave this wiring unasserted, which is how the depth
 * abort stayed deletable after it was supposedly fixed.
 *
 * `variant` decides whether the request context reaches the check at all. The classic
 * model drops it, because check(user, relation, object) has nowhere to put it.
 */
export function makeEvaluator(
  tuples: Tuple[],
  rewrites: Record<string, Rewrite[]>,
  variant: Variant = 'classic',
): Evaluator {
  return {
    async decide(req: AccessRequest) {
      const relation = actionToRelation(req.action);
      const w: Walk = {
        tuples,
        rewrites,
        context: variant === 'conditions' ? req.context : undefined,
        conditions: CONDITIONS,
        trace: [],
        abort: { hit: false },
        vetoed: new Set(),
      };
      const ok = check(w, `user:${req.subject}`, relation, `document:${req.resource}`, []);
      if (w.abort.hit) {
        return {
          decision: 'deny' as const,
          reason: { en: 'Graph search aborted', ja: 'グラフ探索が打ち切られた' },
          detail: w.trace,
          error: w.abort.reason,
        };
      }
      return ok
        ? allow(
            {
              en: `Graph search reached ${relation}`,
              ja: `グラフ探索により ${relation} に到達した`,
            },
            w.trace,
          )
        : w.vetoed.size > 0
          ? deny(
              {
                en: `The path to ${relation} needs ${[...w.vetoed].join(', ')}, which is false at ${String(req.context.hour).padStart(2, '0')}:00`,
                ja: `${relation} への経路には ${[...w.vetoed].join(', ')} が必要だが、${String(req.context.hour).padStart(2, '0')}:00 では偽である`,
              },
              w.trace,
            )
          : deny(
              {
                en: `Graph search could not reach ${relation}`,
                ja: `グラフ探索では ${relation} に到達できなかった`,
              },
              w.trace,
            );
    },
  };
}

function projectRebac(
  scenario: Scenario,
  requirements: readonly string[],
  lang: Lang,
  variant: Variant,
): Projection {
  const tuples = buildTuples(scenario, requirements, variant);
  return {
    sources: [
      {
        label: 'model.fga',
        lang: 'dsl',
        code: buildDsl(requirements, lang, variant),
        note:
          variant === 'classic'
            ? {
                en: 'The classic model defines relations and nothing else, with no place for a condition. Present-day OpenFGA can attach one with a condition block — the next engine does exactly that — so what is demonstrated here is the original gap, not a limitation of the product today.',
                ja: '古典的なモデルは関係の定義のみで構成され、条件を書く場所が無い。現在の OpenFGA は condition ブロックで条件を付与でき、次のエンジンがまさにそれを行う。ここで示しているのは当時の欠落であって現行製品の制約ではない。',
              }
            : {
                en: 'The grant is unchanged from the classic model. within_hours is the only addition: a relation every user holds, but only while business_hours is true, intersected with the grant by `and`.',
                ja: '付与の部分は古典的なモデルと同一である。追加したのは within_hours だけで、全ユーザーが持つが business_hours が真の間しか成立しない関係を、`and` で付与と交差させている。',
              },
      },
      {
        label: 'tuples',
        lang: 'csv',
        code: tuples
          .map(
            (t) =>
              `${t.user}  ${t.relation}  ${t.object}${t.condition ? `  [${t.condition}]` : ''}`,
          )
          .join('\n'),
        note: {
          en: 'Adding a document leaves the model untouched and only adds tuples — the opposite of regenerating Casbin’s policy table.',
          ja: 'document が増えてもモデルは変更されず、タプルが追加されるだけである。Casbin のポリシー表を再生成する方式とは対照的である。',
        },
      },
    ],
    support: variant === 'classic' ? SUPPORT : CONDITIONS_SUPPORT,
  };
}

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

  project: (scenario, requirements, lang) => projectRebac(scenario, requirements, lang, 'classic'),

  async prepare(scenario: Scenario, requirements: readonly string[]): Promise<Evaluator> {
    return makeEvaluator(buildTuples(scenario, requirements), buildRewrites(requirements));
  },
};

export const rebacConditionsEngine: PolicyEngine = {
  meta: {
    id: 'rebac-cond',
    name: 'ReBAC + Conditions',
    paradigm: {
      en: 'Relationship tuples that may carry a condition, evaluated against the request context at check time',
      ja: '条件付きの関係タプルを、check 時にリクエストの context で評価する方式',
    },
    // OpenFGA v1.4.0 (2023-12) enabled conditional relationship tuples by default.
    // SpiceDB shipped the same idea earlier, as experimental caveats in v1.14.0 (2022-11).
    year: 2023,
    origin: 'OpenFGA v1.4 Conditions',
    tagline: {
      en: 'The same graph, with an attribute check laid on top. Relationships say who; a condition says when.',
      ja: '同じグラフの上に属性による判定を重ねる。誰かは関係が、いつかは condition が決める。',
    },
  },

  project: (scenario, requirements, lang) =>
    projectRebac(scenario, requirements, lang, 'conditions'),

  async prepare(scenario: Scenario, requirements: readonly string[]): Promise<Evaluator> {
    return makeEvaluator(
      buildTuples(scenario, requirements, 'conditions'),
      buildRewrites(requirements, 'conditions'),
      'conditions',
    );
  },
};
