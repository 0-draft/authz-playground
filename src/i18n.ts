export type Lang = 'en' | 'ja';
export const LANGS: Lang[] = ['en', 'ja'];
export const DEFAULT_LANG: Lang = 'en';
const STORAGE_KEY = 'authz-playground.lang';

/** A piece of localized content. Both languages are always present. */
export interface L {
  en: string;
  ja: string;
}

export function readStoredLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'en' || v === 'ja') return v;
  } catch {
    // private browsing or blocked storage: fall through to the default
  }
  return DEFAULT_LANG;
}

export function storeLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // persistence is a convenience; the app works without it
  }
}

export const LANG_LABEL: Record<Lang, string> = { en: 'English', ja: '日本語' };

/** Interface copy. Domain content (requirements, engines) lives next to its data. */
export const UI = {
  docTitle: {
    en: 'Authz Playground — four authorization engines, one set of rules',
    ja: 'Authz Playground — 4つの認可エンジンに同一の要件を与える',
  },
  title: {
    en: 'Give four authorization engines the same rules,\nthen watch them disagree',
    ja: '同一の要件を4つの認可エンジンで記述し、\n判定が分かれる条件を観察する',
  },
  intro: {
    en: 'Cedar, OPA / Rego, Casbin and ReBAC. Add one rule at a time and eventually one engine can no longer express it, so its answers start to diverge. That divergence is where each design drew its line — and, in one case, what OpenFGA went back and changed. Every decision here is evaluated in your browser.',
    ja: 'Cedar、OPA / Rego、Casbin、ReBAC の4エンジンを比較する。要件を1つずつ追加していくと、いずれかのエンジンが要件を表現できなくなり、判定が一致しなくなる。この不一致は、各設計がどこに線を引いたかを示している。そして1つのエンジンについては、後年 OpenFGA がその線を引き直した。判定はすべてブラウザ上で実行している。',
  },
  regoLoading: {
    en: 'Loading the OPA Rego compiler (a ~8 MB gzipped WebAssembly module). It joins the comparison as soon as it arrives.',
    ja: 'OPA の Rego コンパイラ (gzip 約 8MB の WebAssembly) を読み込んでいる。完了次第、比較対象に追加される。',
  },
  engineFailed: {
    en: 'An engine could not be loaded, so it is missing from the comparison below.',
    ja: 'エンジンを読み込めなかったため、以下の比較から欠落している。',
  },
  selectedRequest: { en: 'selected:', ja: '選択中:' },
  langLabel: { en: 'Language', ja: '言語' },
  stagesLabel: { en: 'Stages', ja: 'ステージ' },
  stageOf: { en: 'Stage %1 of %2', ja: 'ステージ %1 / %2' },
  broke: { en: '%1: %2 disagreements', ja: '%1 不一致 %2 件' },

  mapHeading: { en: 'Divergence map', ja: '判定差分マップ' },
  mapLede: {
    en: 'Every one of the %1 requests this scenario can produce, evaluated under this stage’s rules. One square is one request; filled means allowed. Only the columns where the engines disagree are marked in pink. Select a square to load that request into the panel below.',
    ja: 'このステージの要件で、シナリオ上ありうる %1 通りのリクエストをすべて評価した結果である。1マスが1リクエストを表し、塗りつぶしは許可を示す。エンジン間で判定が分かれた列のみ桃色で強調される。セルを選択すると、そのリクエストを下の評価パネルに読み込む。',
  },
  mapAxis: {
    en: '← %1 requests (subject × action × resource × hour) →',
    ja: '← %1 通りのリクエスト (subject × action × resource × 時刻) →',
  },
  keyAllow: { en: 'allowed', ja: '許可' },
  keyDeny: { en: 'denied', ja: '拒否' },
  keyClash: { en: 'engines disagree', ja: '判定が分かれた' },
  keyClashDeny: { en: 'denied · engines disagree', ja: '拒否 · 判定が分かれた' },
  keyClashAllow: { en: 'allowed · the outlier', ja: '許可 · 単独で判断が異なる' },
  verdictSummary: {
    en: '%1: %2',
    ja: '%1: %2',
  },
  skipToBench: {
    en: 'Skip the grid and go to the request panel',
    ja: 'グリッドを飛ばして評価パネルへ',
  },
  tallyClean: {
    en: 'Every engine reaches the same answer on all %1 requests at this stage.',
    ja: 'このステージでは %1 通りすべてで全エンジンの判定が一致した。',
  },
  tallyCleanPartial: {
    en: '%1 of %2 engines have loaded, and they agree on all %3 requests.',
    ja: '%2 エンジン中 %1 が読み込み済みで、それらは %3 通りすべてで判定が一致している。',
  },
  tallyClash: {
    en: 'of %1 requests get different answers.',
    ja: '/ %1 通りで判定が分かれた。',
  },

  benchHeading: { en: 'Bench', ja: '評価パネル' },
  benchLede: {
    en: 'Pick one request and send it to all four engines at the same moment. Move the hour to see them come apart.',
    ja: 'リクエストを1つ選択し、同一の条件で4エンジンに評価させる。時刻を変更すると挙動の差が現れる。',
  },
  withinHours: { en: 'within business hours', ja: '営業時間内' },
  outsideHours: { en: 'outside business hours', ja: '営業時間外' },
  evaluating: { en: 'evaluating…', ja: '評価中' },
  clashHead: { en: 'The engines disagree here', ja: 'このリクエストで判定が分かれている' },
  clashGeneric: {
    en: 'The engines answer this request differently, even though none of them declared the rule impossible to express.',
    ja: 'いずれのエンジンもこの要件を表現不可能とは申告していないが、このリクエストでは判定が分かれている。',
  },
  cannotExpress: {
    en: '%1 cannot express “%2”. %3',
    ja: '%1 は「%2」を表現できない。%3',
  },

  graphHeading: { en: 'How ReBAC reaches its answer', ja: 'ReBAC の判定過程' },
  graphLede: {
    en: 'Zanzibar-style engines treat permission as reachability in a graph. The path actually walked for the selected request is drawn in green. Notice there is nowhere in this picture to put a time of day — that is the whole reason for the disagreement above.',
    ja: 'Zanzibar 系のエンジンは、権限をグラフ上の到達可能性として扱う。選択中のリクエストで実際に辿った経路を緑で示す。この図には時刻を与える箇所が存在しない。これが前述の不一致の原因である。',
  },
  graphAlt: { en: 'Relationship tuples and the path walked', ja: '関係タプルのグラフと探索経路' },

  matrixHeading: { en: 'Expressiveness', ja: '表現可能性' },
  matrixLede: {
    en: 'Separate from whether the answers match: can each engine state the rule naturally at all? This is what actually decides which engine you pick in production.',
    ja: '判定が一致するかどうかとは別に、その要件を自然に記述できるかはエンジンごとに異なる。実務でエンジンを選定する際は、こちらが判断材料になる。',
  },
  colRequirement: { en: 'Requirement', ja: '要件' },
  repNative: { en: 'fits the language', ja: '自然に記述できる' },
  repAwkward: { en: 'possible but forced', ja: '記述できるが不自然' },
  repImpossible: { en: 'cannot be expressed', ja: '表現できない' },

  projHeading: {
    en: 'Projection — the same rules in four languages',
    ja: '射影 — 同一の要件を4つの言語で記述する',
  },
  projLede: {
    en: 'One neutral scenario, lowered into each engine’s own representation. The shape of this code says more about each paradigm than the decisions do.',
    ja: '中立なシナリオを各エンジンのネイティブ表現へ変換したものである。判定結果よりも、このコードの形の違いのほうがパラダイムの特徴を表している。',
  },
  emptyAtStage: { en: '(empty at this stage)', ja: '(このステージでは空)' },
  lineCount: { en: '%1 lines', ja: '%1 行' },

  footer: {
    en: 'All four engines run inside your browser: Cedar through its official WebAssembly bindings, Rego by compiling OPA itself to js/wasm, Casbin as its TypeScript implementation, and ReBAC as a teaching reimplementation of the Zanzibar check algorithm. Nothing is sent to a server.',
    ja: '4エンジンはすべてブラウザ内で実行している。Cedar は公式の WebAssembly バインディング、Rego は OPA 本体を js/wasm にビルドしたもの、Casbin は TypeScript 実装、ReBAC は Zanzibar の check アルゴリズムを教材用に再実装したものである。サーバーへの問い合わせは行っていない。',
  },
} satisfies Record<string, L>;

/** Fill %1, %2 … placeholders. */
export function fill(s: string, ...args: (string | number)[]): string {
  return s.replace(/%(\d)/g, (_, i) => String(args[Number(i) - 1] ?? ''));
}
