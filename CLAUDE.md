# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリは何か

同じ認可要件を Cedar / OPA (Rego) / Casbin / ReBAC (Zanzibar) / ReBAC + Conditions (OpenFGA 風の条件付き tuple) の 5 エンジンに与え、どこで答えが割れるかを見せるブラウザ完結の教材サイト（backend なし）。リモートは `0-draft/authz-playground`、main への push で GitHub Pages にデプロイされる。UI とコード内コメントは英語、表示文言は en/ja の 2 言語。

## 構成（big picture）

- `src/core/scenario.ts` — エンジン非依存の中立シナリオ。要件 R1〜R4 と、それを累積的に足す 4 ステージ（`STEPS`）、リクエスト全列挙（`enumerateRequests`）。
- `src/core/engine.ts` — `PolicyEngine` インターフェース。各エンジンは `project()`（ネイティブ表現へ射影し UI に出すソースと表現可能性 `native`/`awkward`/`impossible` を返す）と `prepare()`（評価器を作る）を持つ。
- `src/engines/*` — 各アダプタ。Cedar は `@cedar-policy/cedar-wasm`、Casbin は TS 実装を直接、ReBAC 2 種は `rebac.ts` の教材用再実装（OpenFGA ではない）、Rego は `wasm/rego/main.go` で OPA 自体を `js/wasm` にビルドしたものを `regoRuntime.ts` から呼ぶ。
- `src/core/diff.ts` — differential harness。全リクエストを全エンジンに流して不一致を集計する。
- `src/core/oracle.ts` — 要件文から直書きした独立の正解関数。テスト専用で、意図的に `src/engines` の外に置いている（5 個目の射影にしないため）。
- `src/App.tsx` — 画面本体。`ALL_ENGINES` にエンジンを並べる。Rego は wasm のロード完了後にだけ比較へ加わる（`enginesFor(regoReady)`）。
- `src/i18n.ts` — 表示文言は `L = { en, ja }` で両言語必須。`project()` が生成するソース内コメントも `lang` でローカライズされる。

## 不変条件（壊さないこと）

- **differential harness がこのプロジェクトの主張そのもの**。`src/core/diff.test.ts` が固定しているのは「context を扱える 4 エンジンは全ステージ全リクエストで一致」「乖離するのは classic ReBAC だけで、それも営業時間外の edit だけ」「全エンジンが oracle と一致」「営業時間の境界 08/09/17/18 を直接検証」。射影を直してテストを合わせに行くのではなく、テストが落ちたら射影のバグか本物の意味論差かをまず切り分ける。
- **表現可能性の宣言（`support`）は実測と一致させる**。宣言と挙動がずれるとテストが落ちる設計なので、表を手で書き換えて済ませない。
- **ガードは「消してもテストが通る」状態にしない**。過去に seam 越しにしか検証しておらず guard を削除しても green だった件を潰している（`614375c` / `c8cf10a`）。テストは `decide()` や `runDifferential` などの実配線を通して書く。文言ではなく状態を assert する（`72da6e9`）。
- **Rego wasm はユーザーが貼った任意の Rego をコンパイルする**ので、`main.go` で `http.` / `net.` / `opa.runtime` 系 builtin を capabilities から外している。`http.send` は単一 goroutine を deadlock させて以後ランタイムが死ぬ。builtin の扱いを緩めない。
- **Casbin の role 定義は `g` から連番**。`g` を飛ばして `g2` だけ宣言すると grouping が登録されない（上流仕様、README 参照）。
- 長いループはブラウザを固めないよう `yieldToBrowser()` でリクエスト単位に yield する（エンジン間だけでは足りなかった）。

## 落とし穴

- **`public/rego.wasm`（約 40 MB）と `public/wasm_exec.js` はコミットしない生成物**。無い状態で `npm test` すると `vitest.setup.ts` の preload で落ちる。`npm run build` は無くても成功して Rego 抜きの 4 エンジンサイトになるので、CI は `dist/rego.wasm` のサイズまで検査している。
- vitest は Node なので Cedar は `@cedar-policy/cedar-wasm/nodejs` に alias し、Rego wasm は `vitest.setup.ts` で事前ロードして `globalThis.regoEval` に生やしている。ブラウザ側のロード経路（`regoRuntime.ts`）とは別物。
- Casbin はブラウザで Node の `Buffer` を参照するので `src/polyfill.ts` が `main.tsx` より先に読まれる必要がある。
- Prettier（`format:check`）は `.` 全体が対象で Markdown も含む。`.md` を書いたら `npx prettier --check` も通す。
- deploy は CI と同じ workflow の後段ジョブ。別 workflow にしていたときは harness が落ちたコミットが本番に出た。
- `claude-review.yml` は PR 時のレビュー専用で gate ではない。自身の変更はマージされるまでレビューされない。

## よく使うコマンド

```bash
npm install
npm run build:wasm     # Go 必須。wasm/rego を js/wasm でビルドし public/ に出す
npm run dev

# CI と同じ順の検証
npm run format:check
npm run lint
npm run typecheck
npm test               # differential harness
npm run build

# Go 側（CI の gofmt ジョブ相当）
cd wasm/rego && gofmt -l . && GOOS=js GOARCH=wasm go vet ./...
```

Go のバージョンは `wasm/rego/go.mod` が正（CI も `go-version-file` で追従）。OPA の更新は dependabot が `/wasm/rego` に PR を出す。

## 上流 OPA への PR

このリポ作業から `open-policy-agent/opa` に PR を出すことがある。OPA の `.github/PULL_REQUEST_TEMPLATE.md` は PR 本文を人間が書くことを要求している（AI はコードのみ可）。branch を push して draft で開くか compare URL を渡すまでにして、本文は kt が書く。コミットには DCO sign-off が要る。identity は kt のマージ済み OPA PR #8395 と同じもの (`git log -1 --format='%an <%ae>' --author=kanywst` で引く。ここには書かない)。
