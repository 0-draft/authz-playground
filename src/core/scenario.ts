// The neutral scenario model: a description of the world that depends on no
// policy engine. Each engine adapter "projects" this into its own native form.
// This model is the single source of truth, and the reason the comparison is fair.
import type { L } from '../i18n';

export type UserId = string;
export type FolderId = string;
export type DocumentId = string;

export const ACTIONS = ['view', 'edit', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

export interface Scenario {
  users: UserId[];
  folders: Record<FolderId, { admins: UserId[] }>;
  documents: Record<DocumentId, { owner: UserId; folder: FolderId; isPublic: boolean }>;
}

export interface RequestContext {
  /** 0-23. Used by rules such as "only during business hours". */
  hour: number;
  /** Whether the subject passed multi-factor authentication. */
  mfa: boolean;
}

export interface AccessRequest {
  subject: UserId;
  action: Action;
  resource: DocumentId;
  context: RequestContext;
}

export type Decision = 'allow' | 'deny';

/** A single rule. Every engine declares whether it can express each one. */
export interface Requirement {
  id: string;
  label: L;
}

export const REQUIREMENTS: Record<string, Requirement> = {
  R1: {
    id: 'R1',
    label: {
      en: 'The owner of a document can edit it',
      ja: 'document の owner は編集できる',
    },
  },
  R2: {
    id: 'R2',
    label: {
      en: 'An admin of the folder a document belongs to can also edit it',
      ja: 'document が属する folder の admin も編集できる',
    },
  },
  R3: {
    id: 'R3',
    label: {
      en: 'Editing is only allowed during business hours (09:00-18:00)',
      ja: '編集は営業時間 (9:00-18:00) のみ許可する',
    },
  },
  R4: {
    id: 'R4',
    label: {
      en: 'Anyone can view a public document',
      ja: 'public な document は誰でも閲覧できる',
    },
  },
};

/**
 * A learning stage. Each one adds a single rule, and the added rule
 * gradually exposes the limits of each engine.
 */
export interface Step {
  id: number;
  title: L;
  /** The requirement introduced at this stage. */
  added: string;
  /** The difficulty that the new requirement creates. */
  pain: L;
  requirements: readonly string[];
}

export const STEPS: Step[] = [
  {
    id: 1,
    title: { en: 'A plain if statement', ja: '素朴な if 文' },
    added: 'R1',
    pain: {
      en: 'One comparison is enough. No policy engine is needed yet.',
      ja: '比較1つで表現できる。この段階ではポリシーエンジンを必要としない。',
    },
    requirements: ['R1'],
  },
  {
    id: 2,
    title: { en: 'Relationships must be traversed', ja: '関係の traversal が必要になる' },
    added: 'R2',
    pain: {
      en: 'Permission now depends on the admins of the containing folder, so the answer requires following a relationship.',
      ja: '許可の判断が所属フォルダの admin に依存するため、関係を辿らなければ結論が出ない。',
    },
    requirements: ['R1', 'R2'],
  },
  {
    id: 3,
    title: { en: 'Context enters the decision', ja: 'context が判断に加わる' },
    added: 'R3',
    pain: {
      en: 'Who is acting on what is no longer sufficient: the circumstances of the request itself now affect the decision.',
      ja: '「誰が何に」だけでは判断できず、リクエスト時の状況が結論を左右する。',
    },
    requirements: ['R1', 'R2', 'R3'],
  },
  {
    id: 4,
    title: { en: 'Resource attributes enter', ja: 'リソース属性が加わる' },
    added: 'R4',
    pain: {
      en: 'A flag on the resource itself now takes part in the decision.',
      ja: 'リソース側の属性そのものが判断に関与する。',
    },
    requirements: ['R1', 'R2', 'R3', 'R4'],
  },
];

/** The scenario used by the playground. */
export const DEFAULT_SCENARIO: Scenario = {
  users: ['alice', 'bob', 'carol'],
  folders: {
    engineering: { admins: ['bob'] },
  },
  documents: {
    'design-doc': { owner: 'alice', folder: 'engineering', isPublic: false },
    postmortem: { owner: 'carol', folder: 'engineering', isPublic: true },
  },
};

/**
 * Hours sampled by default.
 *
 * Both edges of the business-hours window R3 declares must appear, together with
 * the hour on each side of them. Sampling only the middle of the day and the
 * middle of the night lets a projection encode the wrong window — 08:00-19:00,
 * say — while still agreeing with every other engine on every sampled request.
 */
export const BOUNDARY_HOURS = [0, 8, 9, 10, 17, 18, 22, 23] as const;

/** Enumerate every request the scenario can produce. This feeds the differential test. */
export function enumerateRequests(
  scenario: Scenario,
  hours: readonly number[] = BOUNDARY_HOURS,
  // No requirement reads mfa, so enumerating both values produced an exact duplicate of
  // every request and silently doubled totalRequests and every divergence count.
  // The field stays because it shows context carrying more than a clock; pass [true,
  // false] explicitly once a requirement depends on it.
  mfaValues: readonly boolean[] = [true],
): AccessRequest[] {
  const out: AccessRequest[] = [];
  for (const subject of scenario.users) {
    for (const action of ACTIONS) {
      for (const resource of Object.keys(scenario.documents)) {
        for (const hour of hours) {
          for (const mfa of mfaValues) {
            out.push({ subject, action, resource, context: { hour, mfa } });
          }
        }
      }
    }
  }
  return out;
}

export function formatRequest(req: AccessRequest): string {
  const h = String(req.context.hour).padStart(2, '0');
  return `${req.subject} ${req.action} ${req.resource} @${h}:00`;
}
