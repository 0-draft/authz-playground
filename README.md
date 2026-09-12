# Authz Playground

Give Cedar, OPA / Rego, Casbin and ReBAC (Zanzibar) the same authorization rules, then watch where their answers diverge — and what each design gave up to draw its line where it did.

Everything runs in the browser. There is no backend.

## What it does

One neutral scenario is defined once, with no reference to any engine. Each engine adapter _projects_ that scenario into its own native representation: Cedar policies and entities, a Rego module and data document, a Casbin model and policy table, and a set of Zanzibar relationship tuples.

Requirements are then added one at a time:

| Stage | Requirement added                       | What it forces                             |
| ----- | --------------------------------------- | ------------------------------------------ |
| 1     | The owner can edit                      | A single comparison. No engine needed yet. |
| 2     | Folder admins can edit too              | The decision must traverse a relationship. |
| 3     | Editing only during business hours      | Request-time context enters the decision.  |
| 4     | Public documents are viewable by anyone | A resource attribute enters the decision.  |

At stage 3 the ReBAC model stops agreeing with the others. This is not a bug in the comparison: `check(user, relation, object)` has three arguments and none of them can carry a time of day. OpenFGA added Conditions years later to close exactly this gap.

## Why the comparison can be trusted

"Send the same request to four engines" is not well defined, because the engines do not share an input model. Cedar takes a fixed `(principal, action, resource, context)` tuple, Rego takes arbitrary JSON, Casbin takes a variable-length tuple matched by an expression, and Zanzibar takes `(user, relation, object)`, with no place in the model for an attribute condition.

So the projections are the interesting part, and their fidelity is verified mechanically. A differential harness enumerates every request the scenario can produce and runs all of them through every engine. A disagreement has only two possible causes:

1. A bug in the projection, which is a defect to fix.
2. A genuine semantic difference between engines, which is the teaching material.

The test suite pins this down: the three context-capable engines must agree on every request at every stage, and ReBAC must be the only engine that ever diverges. If a projection quietly grants something the requirements never asked for, CI fails.

Each engine also _declares_ which requirements it can express, and a test asserts that the declaration matches the measured behaviour. The expressiveness matrix cannot drift away from the truth without breaking the build.

## Running it

Building the Rego engine requires a Go toolchain, because it compiles OPA itself to `js/wasm`. The resulting module is about 40 MB (8 MB gzipped) and is not committed.

```bash
npm install
npm run build:wasm   # requires Go; writes public/rego.wasm + wasm_exec.js
npm run dev
```

Other useful commands:

```bash
npm test             # differential harness
npm run lint
npm run typecheck
npm run build
```

## How each engine runs in the browser

| Engine     | How it evaluates                                                       |
| ---------- | ---------------------------------------------------------------------- |
| Cedar      | Official `@cedar-policy/cedar-wasm` bindings                           |
| OPA / Rego | OPA compiled to `js/wasm`, so policies are compiled and evaluated live |
| Casbin     | `casbin`, the TypeScript implementation, runs directly                 |
| ReBAC      | A teaching reimplementation of the Zanzibar check algorithm            |

The ReBAC engine is not OpenFGA. It reimplements the parts that matter for understanding the model — relation rewrites and tuple-to-userset traversal — and is labelled as such in the interface.

## A note on Casbin role definitions

Casbin numbers role definitions consecutively from `g`, and `loadSection` stops at the first missing index. A model that declares `g2` without also declaring `g` therefore never registers the grouping at all, and the matcher ends up calling a function that was never installed. Go Casbin contains the same loop, so this is a naming constraint rather than an implementation defect. It was reported upstream against the Go implementation in 2018 and closed as intended behaviour. Only one grouping is needed here, so it is named `g`.

## Contributing

Issues and pull requests are welcome. CI runs Prettier, ESLint, tsc, the differential
harness, the production build, gofmt and go vet. A Claude review runs on pull requests
as well, aimed at what the tests cannot see: a projection that grants something the
requirements never asked for, an expressiveness rating the code does not justify, or a
factual claim in the copy.

## Licence

MIT
