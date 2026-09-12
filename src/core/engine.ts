import type { L, Lang } from '../i18n';
import type { AccessRequest, Decision, Scenario } from './scenario';

/** How naturally a requirement can be written in a given engine. */
export type Representability =
  /** Within what the language was designed for. Writes straightforwardly. */
  | 'native'
  /** Possible, but forced: needs pre-expansion, wildcards or other workarounds. */
  | 'awkward'
  /** The concept does not exist in the model. There is no way to write it. */
  | 'impossible';

export interface RequirementSupport {
  level: Representability;
  /** One line explaining why. Shown in the expressiveness matrix. */
  note: L;
}

/** A projected, engine-native representation, shown side by side in the UI. */
export interface SourceView {
  label: string;
  lang: 'rego' | 'cedar' | 'ini' | 'csv' | 'dsl' | 'json';
  code: string;
  /** What to look at in this particular piece of source. */
  note?: L;
}

export interface Projection {
  sources: SourceView[];
  support: Record<string, RequirementSupport>;
}

export interface EngineResult {
  decision: Decision;
  /** Why the engine answered this way, in human terms. */
  reason: L;
  /** Engine-specific detail: a Rego trace, Cedar's determining policies, and so on. */
  detail?: string[];
  error?: string;
}

export interface Evaluator {
  decide(req: AccessRequest): Promise<EngineResult>;
}

export interface EngineMeta {
  id: string;
  /** Product name. Not translated. */
  name: string;
  /** The paradigm of its language or model. */
  paradigm: L;
  /** Year of introduction, used to order the engines historically. */
  year: number;
  origin: string;
  tagline: L;
}

export interface PolicyEngine {
  meta: EngineMeta;
  /**
   * Lower the scenario and requirements into this engine's own representation.
   * `lang` localizes the comments inside the generated source, which is shown to the reader.
   */
  project(scenario: Scenario, requirements: readonly string[], lang: Lang): Projection;
  /** Build an evaluator. Compilation and loading happen here, once. */
  prepare(scenario: Scenario, requirements: readonly string[]): Promise<Evaluator>;
}

export const allow = (reason: L, detail?: string[]): EngineResult => ({
  decision: 'allow',
  reason,
  detail,
});

export const deny = (reason: L, detail?: string[]): EngineResult => ({
  decision: 'deny',
  reason,
  detail,
});
