import { newEnforcer, newModelFromString, StringAdapter } from 'casbin';
import type { Evaluator, PolicyEngine, Projection, RequirementSupport } from '../core/engine';
import { allow, deny } from '../core/engine';
import type { AccessRequest, Scenario } from '../core/scenario';
import type { L, Lang } from '../i18n';

function buildModel(requirements: readonly string[]): string {
  const has = (r: string) => requirements.includes(r);

  // Every requirement is pushed into a single matcher expression. Casbin models
  // policy as one large condition, so non-orthogonal rules make it hard to read fast.
  const conds = [
    has('R4') ? '(r.sub == p.sub || p.sub == "*")' : 'r.sub == p.sub',
    has('R2') ? '(r.obj == p.obj || g(r.obj, p.obj))' : 'r.obj == p.obj',
    'r.act == p.act',
  ];
  // R3 must apply to edit only, so the per-action branch is embedded in the expression too.
  if (has('R3')) conds.push('(r.act != "edit" || (r.hour >= 9 && r.hour < 18))');

  // Casbin numbers role definitions consecutively from g, and loadSection stops at the
  // first missing index, so declaring g2 without g registers no grouping at all and the
  // matcher calls a function that was never installed. Go Casbin has the same loop, so
  // this is a naming constraint rather than a node-casbin defect. Convention pairs g
  // (user roles) with g2 (resource roles); only one grouping is needed here, so it is g.
  const roleDef = has('R2') ? '\n[role_definition]\ng = _, _\n' : '\n';

  return `[request_definition]
r = sub, obj, act, hour

[policy_definition]
p = sub, obj, act
${roleDef}
[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = ${conds.join(' && ')}`;
}

function buildPolicy(scenario: Scenario, requirements: readonly string[]): string {
  const has = (r: string) => requirements.includes(r);
  const rows: string[] = [];

  for (const [doc, d] of Object.entries(scenario.documents)) {
    // R1: with the resource passed as an opaque id, ownership is data rather than a
    // role, so it has to be expanded into one policy row per document.
    if (has('R1')) rows.push(`p, ${d.owner}, ${doc}, edit`);
    // R4: "anyone" becomes a wildcard row.
    if (has('R4') && d.isPublic) rows.push(`p, *, ${doc}, view`);
  }

  if (has('R2')) {
    // R2: an admin's permission is granted on the folder in a single row,
    // and the document-to-folder membership is carried by the grouping.
    for (const [folder, f] of Object.entries(scenario.folders)) {
      for (const admin of f.admins) rows.push(`p, ${admin}, ${folder}, edit`);
    }
    for (const [doc, d] of Object.entries(scenario.documents)) {
      rows.push(`g, ${doc}, ${d.folder}`);
    }
  }

  // node-casbin rejects an empty policy document outright ("policy document cannot
  // be false-y"), so a requirement set that grants nothing would make this the only
  // engine that cannot be projected at all. The other three simply deny everything.
  // An unmatchable row keeps the projection valid and changes no decision.
  if (rows.length === 0) rows.push('p, __none__, __none__, __none__');

  return rows.join('\n');
}

const SUPPORT: Record<string, RequirementSupport> = {
  R1: {
    level: 'awkward',
    note: {
      en: 'This projection passes the resource as an opaque id, so ownership has to be expanded into one policy row per document and the table must be regenerated whenever a document is added. Casbin can avoid that in ABAC mode by passing the resource as an object and matching r.sub == r.obj.owner, at the cost of the policy table no longer being the whole policy.',
      ja: 'この射影は resource を不透明な ID として渡すため、所有関係を document 1件ごとのポリシー行へ展開する必要があり、document が追加されるたびに表の再生成を要する。Casbin は ABAC モードで resource をオブジェクトとして渡し r.sub == r.obj.owner と記述すればこれを回避できるが、その場合はポリシー表がポリシーの全体ではなくなる。',
    },
  },
  R2: {
    level: 'native',
    note: {
      en: 'Object grouping expresses document-to-folder membership, so a permission on the folder reaches the document. Hierarchy is what Casbin is good at.',
      ja: 'object grouping により document と folder の所属関係を表現でき、folder に対する権限が document に波及する。階層構造は Casbin が得意とする領域である。',
    },
  },
  R3: {
    level: 'awkward',
    note: {
      en: 'In this projection the hour is appended to the request tuple and tested inside the matcher, so the per-action branch lands in the same expression and readability degrades quickly. Casbin can instead move the condition into the policy row with eval() and leave the matcher fixed, which is the better shape once the conditions outnumber the rules.',
      ja: 'この射影では hour を request タプルに追加し matcher 式の中で判定するため、action ごとの分岐も同じ式に入り可読性が急速に低下する。Casbin には条件をポリシー行側へ移して matcher を固定できる eval() もあり、条件の数がルールの数を上回る段階ではそちらのほうが適している。',
    },
  },
  R4: {
    level: 'awkward',
    note: {
      en: 'Needs both a wildcard row and a matching `|| p.sub == "*"` clause in the matcher.',
      ja: 'ワイルドカード行と、matcher 側の `|| p.sub == "*"` の両方を用意する必要がある。',
    },
  },
};

const MODEL_NOTE: L = {
  en: 'Written this way, conditions accumulate in one matcher line as requirements grow. This is where that style gives out.',
  ja: 'この書き方では、要件が増えるほど matcher の1行に条件が積み上がる。この方式の可読性はここで限界に達する。',
};

const POLICY_NOTE: L = {
  en: 'The owner rows are generated from scenario data, so adding a document means regenerating this table.',
  ja: 'owner の行はシナリオのデータから生成されている。document が増えた場合はこの表の再生成が必要になる。',
};

export const casbinEngine: PolicyEngine = {
  meta: {
    id: 'casbin',
    name: 'Casbin',
    paradigm: {
      en: 'A model file plus a policy table, evaluated by a matcher expression',
      ja: 'モデル定義とポリシー表を matcher 式で評価する方式',
    },
    year: 2017,
    origin: 'Yang Luo / Apache Casbin (incubating since 2026)',
    tagline: {
      en: 'A general engine whose access model is swapped out by configuration. RBAC or ABAC, depending on the matcher.',
      ja: 'モデルを設定ファイルで差し替える汎用エンジン。RBAC にも ABAC にも matcher 次第で対応する。',
    },
  },

  project(scenario: Scenario, requirements: readonly string[], _lang: Lang): Projection {
    return {
      sources: [
        { label: 'model.conf', lang: 'ini', code: buildModel(requirements), note: MODEL_NOTE },
        {
          label: 'policy.csv',
          lang: 'csv',
          code: buildPolicy(scenario, requirements),
          note: POLICY_NOTE,
        },
      ],
      support: SUPPORT,
    };
  },

  async prepare(scenario: Scenario, requirements: readonly string[]): Promise<Evaluator> {
    const enforcer = await newEnforcer(
      newModelFromString(buildModel(requirements)),
      new StringAdapter(buildPolicy(scenario, requirements)),
    );

    return {
      async decide(req: AccessRequest) {
        const ok = await enforcer.enforce(req.subject, req.resource, req.action, req.context.hour);
        return ok
          ? allow({
              en: 'A row in policy.csv satisfied the matcher expression',
              ja: 'policy.csv のいずれかの行が matcher 式を満たした',
            })
          : deny({
              en: 'No row in policy.csv satisfied the matcher expression',
              ja: 'matcher 式を満たす行が policy.csv に存在しなかった',
            });
      },
    };
  },
};
