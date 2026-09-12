import type { Evaluator, PolicyEngine, Projection, RequirementSupport } from '../core/engine';
import { allow, deny } from '../core/engine';
import type { AccessRequest, Scenario } from '../core/scenario';
import type { L, Lang } from '../i18n';
import { ensureRegoLoaded, evalRego } from './regoRuntime';

const COMMENTS: Record<string, L> = {
  R1: { en: '# R1: the owner can edit', ja: '# R1: owner は編集できる' },
  R2: {
    en: '# R2: an admin of the containing folder can also edit',
    ja: '# R2: 所属フォルダの admin も編集できる',
  },
  R4: {
    en: '# R4: anyone can view a public document',
    ja: '# R4: public な document は誰でも閲覧できる',
  },
};

function buildPolicy(requirements: readonly string[], lang: Lang): string {
  const has = (r: string) => requirements.includes(r);
  const parts: string[] = ['package authz', '', 'default allow := false'];

  const businessHours = has('R3') ? ['\tinput.context.hour >= 9', '\tinput.context.hour < 18'] : [];

  if (has('R1')) {
    parts.push(
      '',
      COMMENTS.R1[lang],
      'allow if {',
      '\tinput.action == "edit"',
      '\tdata.documents[input.resource].owner == input.subject',
      ...businessHours,
      '}',
    );
  }
  if (has('R2')) {
    parts.push(
      '',
      COMMENTS.R2[lang],
      'allow if {',
      '\tinput.action == "edit"',
      '\tfolder := data.documents[input.resource].folder',
      '\tdata.folders[folder].admins[_] == input.subject',
      ...businessHours,
      '}',
    );
  }
  if (has('R4')) {
    parts.push(
      '',
      COMMENTS.R4[lang],
      'allow if {',
      '\tinput.action == "view"',
      '\tdata.documents[input.resource].isPublic',
      '}',
    );
  }
  return parts.join('\n');
}

const SUPPORT: Record<string, RequirementSupport> = {
  R1: {
    level: 'native',
    note: {
      en: 'Input is arbitrary JSON and can be referenced directly.',
      ja: '入力が任意の JSON であり、そのまま参照して記述できる。',
    },
  },
  R2: {
    level: 'native',
    note: {
      en: 'Look up the folder and scan its admins. The traversal is written by hand, so deeper hierarchies mean writing recursion yourself.',
      ja: 'folder を引いて admins を走査する。traversal を自分で記述するため、階層が深くなる場合は再帰を自作することになる。',
    },
  },
  R3: {
    level: 'native',
    note: {
      en: 'Since input is arbitrary JSON, context is just another field. Two more lines.',
      ja: 'input が任意の JSON であるため context も単なるフィールドであり、条件を2行追加するだけで済む。',
    },
  },
  R4: {
    level: 'native',
    note: {
      en: 'A resource attribute lookup. Nothing about this is special in Rego.',
      ja: 'リソース属性の参照であり、Rego にとって特別な処理ではない。',
    },
  },
};

export const regoEngine: PolicyEngine = {
  meta: {
    id: 'rego',
    name: 'OPA / Rego',
    paradigm: {
      en: 'Declarative logic programming, in the Datalog lineage',
      ja: '宣言型ロジックプログラミング (Datalog 系)',
    },
    year: 2016,
    origin: 'Styra / CNCF',
    tagline: {
      en: 'The centre of the policy-as-code movement. The most expressive of the four, and the one that asks the most of the person writing it.',
      ja: 'policy as code の潮流の中心。4つの中で最も表現力が高く、そのぶん書き手に委ねられる範囲も広い。',
    },
  },

  project(scenario: Scenario, requirements: readonly string[], lang: Lang): Projection {
    return {
      sources: [
        {
          label: 'policy.rego',
          lang: 'rego',
          code: buildPolicy(requirements, lang),
          note: {
            en: 'Every requirement costs a few more lines. The ceiling is high, which also means anything at all can be written here.',
            ja: 'いずれの要件も数行の追加で表現できる。表現力の上限が高い反面、何でも記述できてしまう。',
          },
        },
        {
          label: 'data.json',
          lang: 'json',
          code: JSON.stringify(
            { documents: scenario.documents, folders: scenario.folders },
            null,
            2,
          ),
          note: {
            en: 'Data is arbitrary JSON with no schema, so a typo is not caught until evaluation time.',
            ja: 'data はスキーマのない任意の JSON であるため、綴りの誤りは評価時まで検出されない。',
          },
        },
      ],
      support: SUPPORT,
    };
  },

  async prepare(scenario: Scenario, requirements: readonly string[]): Promise<Evaluator> {
    await ensureRegoLoaded();
    const policy = buildPolicy(requirements, 'en');

    return {
      async decide(req: AccessRequest) {
        const res = evalRego(
          policy,
          'data.authz.allow',
          {
            subject: req.subject,
            action: req.action,
            resource: req.resource,
            context: req.context,
          },
          { documents: scenario.documents, folders: scenario.folders },
          false,
        );

        if (!res.ok) {
          return {
            decision: 'deny' as const,
            reason: { en: 'Rego evaluation failed', ja: 'Rego の評価に失敗した' },
            error: res.error,
          };
        }
        return res.value === true
          ? allow({ en: 'An allow rule matched', ja: 'いずれかの allow ルールが成立した' })
          : deny({
              en: 'No allow rule matched, so default allow := false stands',
              ja: 'いずれの allow ルールも成立せず、default allow := false が適用された',
            });
      },
    };
  },
};
