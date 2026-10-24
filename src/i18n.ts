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
    en: 'Authz Playground: the same rules in Cedar, Rego, Casbin and Zanzibar',
    ja: 'Authz Playground: Cedar、Rego、Casbin、Zanzibar に同じ要件を与える',
  },
  title: {
    en: 'Same rules, five authorization engines. Where do their answers part?',
    ja: '同じ要件を5つの認可エンジンに。どこで答えが分かれるか',
  },
  intro: {
    en: 'Cedar, OPA / Rego, Casbin and a Zanzibar-style ReBAC model are given the same rules one at a time. At the third rule the classic Zanzibar model can no longer say what the others say. The fifth engine is that same model with the conditions OpenFGA added later, so you can see the gap and the fix side by side. Everything is evaluated in your browser.',
    ja: 'Cedar、OPA / Rego、Casbin、Zanzibar 型の ReBAC に同じ要件を1つずつ与える。3つ目の要件で、古典的な Zanzibar のモデルだけが他と同じことを表現できなくなる。5つ目のエンジンは、その同じモデルに後年 OpenFGA が追加した condition を足したもので、欠落とその解決を並べて見られる。判定はすべてブラウザ内で行っている。',
  },
  regoLoading: {
    en: 'Loading the OPA compiler, an 8 MB WebAssembly module. Rego joins the comparison when it arrives.',
    ja: 'OPA コンパイラ (8 MB の WebAssembly) を読み込んでいる。完了すると Rego が比較に加わる。',
  },
  engineFailed: {
    en: 'An engine could not be loaded and is missing from every comparison below:',
    ja: '次のエンジンを読み込めなかったため、以下の比較から外れている:',
  },
  langLabel: { en: 'Language', ja: '言語' },

  stagesLabel: { en: 'Rules in force', ja: '適用中の要件' },
  stageAdds: { en: 'Rule added at this stage', ja: 'このステージで追加する要件' },
  stageAgree: { en: 'all agree', ja: '全一致' },
  stageAgreePartial: { en: 'agree so far', ja: '読み込み済みは一致' },
  stageSplit: { en: '%1 split', ja: '%1 件で分岐' },
  stagePending: { en: 'evaluating', ja: '評価中' },

  askHeading: { en: 'Ask one question', ja: '1つの問いを投げる' },
  askLede: {
    en: 'Each line is one engine’s answer to this question at every hour of the day. A raised line means allow. Once a rule reads the clock, business hours are shaded, and red marks the hours where the engines disagree. Drag across the chart or use the arrow keys to move the hour.',
    ja: '各行は、この問いに対する1つのエンジンの答えを1日の各時刻について並べたものである。線が上がっている時刻は許可を表す。時刻を参照する要件が入ると営業時間を網掛けで示し、エンジン間で判定が分かれた時刻を赤で示す。チャート上をドラッグするか矢印キーで時刻を動かせる。',
  },
  askSentence: { en: 'Can %s %a %r at %h?', ja: '%s は %h に %r を %a できるか' },
  askSubjectLabel: { en: 'Subject', ja: 'サブジェクト' },
  askActionLabel: { en: 'Action', ja: 'アクション' },
  askResourceLabel: { en: 'Resource', ja: 'リソース' },
  hourLabel: { en: 'Hour of the request', ja: 'リクエストの時刻' },
  businessHours: { en: 'business hours', ja: '営業時間' },
  withinHours: { en: 'within business hours', ja: '営業時間内' },
  outsideHours: { en: 'outside business hours', ja: '営業時間外' },
  allowWord: { en: 'Allow', ja: '許可' },
  denyWord: { en: 'Deny', ja: '拒否' },
  failedWord: { en: 'Error', ja: 'エラー' },
  evaluating: { en: 'evaluating…', ja: '評価中…' },
  splitHere: { en: 'The engines disagree at %1.', ja: '%1 ではエンジン間で判定が分かれている。' },
  cannotExpress: {
    en: '%1 cannot express “%2”. %3',
    ja: '%1 は「%2」を表現できない。%3',
  },
  clashGeneric: {
    en: 'None of the engines declared this rule impossible to express, so the disagreement points at a projection bug.',
    ja: 'どのエンジンもこの要件を表現不能とは申告していないため、この不一致は射影の不具合を示している。',
  },
  verdictSummary: { en: '%1: %2', ja: '%1: %2' },

  mapHeading: { en: 'Every request at this stage', ja: 'このステージの全リクエスト' },
  mapLede: {
    en: 'All %1 requests the scenario can produce, at the hours either side of each edge of business hours. A filled square is allow. Columns where the engines disagree are marked in red, and the engine in the minority is outlined. Select a square to ask that question above.',
    ja: 'シナリオで起こりうる %1 通りのリクエストを、営業時間の両端とその前後の時刻で評価した。塗りつぶしは許可を表す。判定が分かれた列は赤で示し、少数派のエンジンを枠で囲む。マスを選択すると、その問いを上に読み込む。',
  },
  mapSubject: { en: 'as %1', ja: '%1 として' },
  keyAllow: { en: 'allowed', ja: '許可' },
  keyDeny: { en: 'denied', ja: '拒否' },
  keyClash: { en: 'engines disagree', ja: '判定が分かれた' },
  keyOutlier: { en: 'the minority answer', ja: '少数派の判定' },
  keySelected: { en: 'the question above', ja: '上で選択中の問い' },
  tallyClean: {
    en: 'Every engine gives the same answer to all %1 requests.',
    ja: '%1 通りすべてで全エンジンの判定が一致した。',
  },
  tallyCleanPartial: {
    en: 'The %1 of %2 engines loaded so far agree on all %3 requests.',
    ja: '読み込み済みの %1 / %2 エンジンは、%3 通りすべてで判定が一致している。',
  },
  tallyClash: {
    en: 'of %1 requests get different answers.',
    ja: '/ %1 通りで判定が分かれた。',
  },

  graphHeading: { en: 'How the ReBAC models reach their answer', ja: 'ReBAC モデルの判定過程' },
  graphLede: {
    en: 'Zanzibar treats permission as reachability: the question is whether a path of relationship tuples leads from the user to the relation. The path walked for the question above is drawn in ink. The classic model has nowhere to put the hour. With conditions, one extra tuple carries it, and it is drawn in red when it fails.',
    ja: 'Zanzibar は権限を到達可能性として扱い、ユーザーから関係までタプルの経路が繋がるかを問う。上で選択中の問いについて実際に辿った経路を濃く描く。古典的なモデルには時刻を置く場所がない。condition 版では1本のタプルが時刻を引き受け、条件が偽のときは赤で示す。',
  },
  graphAlt: { en: 'Relationship tuples and the path walked', ja: '関係タプルのグラフと探索経路' },
  variantClassic: { en: 'Zanzibar (2019)', ja: 'Zanzibar (2019)' },
  variantConditions: {
    en: 'With conditions (OpenFGA v1.4, 2023)',
    ja: 'condition 付き (OpenFGA v1.4, 2023年)',
  },
  graphReached: { en: 'Reached %1.', ja: '%1 に到達した。' },
  graphNotReached: { en: 'No path to %1.', ja: '%1 への経路がない。' },
  conditionFalse: { en: 'false at %1', ja: '%1 では偽' },
  conditionTrue: { en: 'true at %1', ja: '%1 では真' },
  traceLabel: { en: 'Check trace', ja: 'check のトレース' },

  matrixHeading: { en: 'What each engine can say', ja: '各エンジンが表現できること' },
  matrixLede: {
    en: 'Matching answers are not the whole story. This is whether each rule can be written naturally at all, which is what decides the choice in production.',
    ja: '判定が一致するかどうかとは別に、その要件を自然に書けるかという問題がある。実務でエンジンを選ぶときに効くのはこちらである。',
  },
  repNative: { en: 'Fits the language', ja: '自然に書ける' },
  repAwkward: { en: 'Possible but forced', ja: '書けるが不自然' },
  repImpossible: { en: 'Cannot be expressed', ja: '表現できない' },

  projHeading: {
    en: 'The same rules, as each engine writes them',
    ja: '同じ要件を各エンジンの言語で',
  },
  projLede: {
    en: 'One neutral scenario, lowered into each engine’s own representation. The shape of this code says more about each design than the decisions do.',
    ja: '中立なシナリオを各エンジン固有の表現へ変換したもの。判定結果よりも、このコードの形のほうが各設計の性格をよく表している。',
  },
  emptyAtStage: { en: '(empty at this stage)', ja: '(このステージでは空)' },
  lineCount: { en: '%1 lines', ja: '%1 行' },

  editHeading: { en: 'Edit the Rego policy', ja: 'Rego ポリシーを編集する' },
  editLede: {
    en: 'This is the policy above, compiled by OPA in your browser. Change it and every request is evaluated again and compared with the policy shipped for this stage.',
    ja: '上の policy.rego を OPA がブラウザ内でコンパイルする。書き換えると全リクエストを評価し直し、このステージで提供しているポリシーとの判定差を示す。',
  },
  editLabel: { en: 'policy.rego', ja: 'policy.rego' },
  editReset: { en: 'Reset', ja: '元に戻す' },
  editWaiting: {
    en: 'Waiting for the OPA module to load…',
    ja: 'OPA モジュールの読み込みを待っている…',
  },
  editFailed: { en: 'OPA rejected the policy:', ja: 'OPA がポリシーを受け付けなかった:' },
  editSame: {
    en: 'Same decision as the shipped policy on all %1 requests.',
    ja: '%1 件すべてで元のポリシーと同じ判定になった。',
  },
  editDiff: {
    en: '%1 of %2 requests now get a different decision:',
    ja: '%2 件中 %1 件で判定が変わった:',
  },
  editMore: { en: '…and %1 more', ja: '…ほか %1 件' },

  footer: {
    en: 'Cedar runs through its official WebAssembly bindings, Rego by compiling OPA itself to js/wasm, and Casbin as its TypeScript implementation. Both ReBAC models are a teaching reimplementation of the Zanzibar check algorithm, not OpenFGA itself. Nothing is sent to a server.',
    ja: 'Cedar は公式の WebAssembly バインディング、Rego は OPA 本体を js/wasm にビルドしたもの、Casbin は TypeScript 実装で動かしている。2つの ReBAC モデルは Zanzibar の check アルゴリズムを教材用に再実装したもので、OpenFGA そのものではない。サーバーへの通信は行わない。',
  },
  source: { en: 'Source on GitHub', ja: 'GitHub のソース' },
} satisfies Record<string, L>;

/** Fill %1, %2 … placeholders. */
export function fill(s: string, ...args: (string | number)[]): string {
  return s.replace(/%(\d)/g, (_, i) => String(args[Number(i) - 1] ?? ''));
}
