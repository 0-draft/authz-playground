import { cedar, ensureCedarLoaded } from './cedarRuntime';
import type { Evaluator, PolicyEngine, Projection, RequirementSupport } from '../core/engine';
import { allow, deny } from '../core/engine';
import type { AccessRequest, Scenario } from '../core/scenario';
import type { L, Lang } from '../i18n';

const entityRef = (type: string, id: string) => ({ __entity: { type, id } });

function buildEntities(scenario: Scenario) {
  return [
    ...scenario.users.map((u) => ({ uid: { type: 'User', id: u }, attrs: {}, parents: [] })),
    ...Object.entries(scenario.folders).map(([id, f]) => ({
      uid: { type: 'Folder', id },
      attrs: { admins: f.admins.map((u) => entityRef('User', u)) },
      parents: [],
    })),
    ...Object.entries(scenario.documents).map(([id, d]) => ({
      uid: { type: 'Document', id },
      attrs: {
        owner: entityRef('User', d.owner),
        folder: entityRef('Folder', d.folder),
        isPublic: d.isPublic,
      },
      parents: [],
    })),
  ];
}

const COMMENTS: Record<string, L> = {
  R1: { en: '// R1: the owner can edit', ja: '// R1: owner は編集できる' },
  R2: {
    en: '// R2: an admin of the containing folder can also edit',
    ja: '// R2: 所属フォルダの admin も編集できる',
  },
  R4: {
    en: '// R4: anyone can view a public document',
    ja: '// R4: public な document は誰でも閲覧できる',
  },
};

function buildPolicies(requirements: readonly string[], lang: Lang): string {
  const has = (r: string) => requirements.includes(r);
  // R3 costs exactly one extra condition, because context is built into the request model.
  const hours = has('R3') ? ' && context.hour >= 9 && context.hour < 18' : '';
  const out: string[] = [];

  if (has('R1')) {
    out.push(
      `${COMMENTS.R1[lang]}\n` +
        `permit(principal, action == Action::"edit", resource)\n` +
        `when { resource.owner == principal${hours} };`,
    );
  }
  if (has('R2')) {
    out.push(
      `${COMMENTS.R2[lang]}\n` +
        `permit(principal, action == Action::"edit", resource)\n` +
        `when { resource.folder.admins.contains(principal)${hours} };`,
    );
  }
  if (has('R4')) {
    out.push(
      `${COMMENTS.R4[lang]}\n` +
        `permit(principal, action == Action::"view", resource)\n` +
        `when { resource.isPublic };`,
    );
  }
  return out.join('\n\n');
}

const SUPPORT: Record<string, RequirementSupport> = {
  R1: {
    level: 'native',
    note: {
      en: 'A direct attribute comparison. One policy covers it.',
      ja: 'resource の属性比較そのものであり、ポリシー1本で記述できる。',
    },
  },
  R2: {
    level: 'native',
    note: {
      en: "Follow the resource's folder reference and test set membership with contains. Cedar also has an entity hierarchy and an in operator; this projection does not need them, because the relationship is held as an attribute.",
      ja: 'resource から folder の参照を辿り、contains で集合の包含を判定する。Cedar には entity 階層と in 演算子も存在するが、この射影では関係を属性として保持しているため使用していない。',
    },
  },
  R3: {
    level: 'native',
    note: {
      en: 'Context is the fourth element of a request from the start, so this is one extra condition.',
      ja: 'context がリクエストの第4項として最初から存在するため、条件を1つ追加するだけで済む。',
    },
  },
  R4: {
    level: 'native',
    note: {
      en: 'A resource attribute lookup. ABAC is what Cedar was designed for.',
      ja: 'リソース属性の参照である。ABAC は Cedar の設計上の想定内にある。',
    },
  },
};

export const cedarEngine: PolicyEngine = {
  meta: {
    id: 'cedar',
    name: 'Cedar',
    paradigm: {
      en: 'Declarative DSL, deliberately restricted so it stays analyzable',
      ja: '宣言型 DSL (解析可能性を保つため表現力を意図的に制限)',
    },
    year: 2023,
    origin: 'AWS',
    tagline: {
      en: 'Fast, safe, and provable. The generation that traded expressiveness for formal verification.',
      ja: '高速性・安全性・検証可能性を優先し、形式検証できる範囲に言語を絞った世代。',
    },
  },

  project(scenario: Scenario, requirements: readonly string[], lang: Lang): Projection {
    return {
      sources: [
        {
          label: 'policies.cedar',
          lang: 'cedar',
          code: buildPolicies(requirements, lang),
          note: {
            en: 'Each new rule adds one policy. Traversal and conditions are both handled by the language itself.',
            ja: '要件が増えてもポリシーが1本増えるだけである。関係の traversal も条件も言語側が担う。',
          },
        },
        {
          label: 'entities.json',
          lang: 'json',
          code: JSON.stringify(buildEntities(scenario), null, 2),
          note: {
            en: 'Entities and their attributes live apart from the policies, so adding data never edits a policy.',
            ja: 'entity とその属性はポリシーから分離されている。データが増えてもポリシーは変更されない。',
          },
        },
      ],
      support: SUPPORT,
    };
  },

  async prepare(scenario: Scenario, requirements: readonly string[]): Promise<Evaluator> {
    await ensureCedarLoaded();
    const policies = buildPolicies(requirements, 'en');
    const entities = buildEntities(scenario);

    return {
      async decide(req: AccessRequest) {
        const res = cedar.isAuthorized({
          principal: { type: 'User', id: req.subject },
          action: { type: 'Action', id: req.action },
          resource: { type: 'Document', id: req.resource },
          context: { hour: req.context.hour, mfa: req.context.mfa },
          policies: { staticPolicies: policies },
          entities,
        });

        if (res.type === 'failure') {
          return {
            decision: 'deny' as const,
            reason: { en: 'Policy evaluation failed', ja: 'ポリシーの評価に失敗した' },
            error: JSON.stringify(res.errors),
          };
        }

        const determining = res.response.diagnostics?.reason ?? [];
        if (res.response.decision === 'allow') {
          return allow(
            {
              en: `Satisfied by permit policy ${determining.join(', ')}`,
              ja: `permit ポリシー ${determining.join(', ')} が成立した`,
            },
            determining.map((p) => `determining policy: ${p}`),
          );
        }
        return deny({
          en: 'No permit policy matched; Cedar denies by default',
          ja: 'いずれの permit ポリシーも成立しなかった (Cedar は既定で拒否する)',
        });
      },
    };
  },
};
