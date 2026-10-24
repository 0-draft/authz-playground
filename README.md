# Authz Playground

Give Cedar, OPA / Rego, Casbin and ReBAC (Zanzibar) the same authorization rules, then watch where their answers diverge — and what each design gave up to draw its line where it did. A fifth engine runs the same ReBAC model with the conditions OpenFGA added later, so the gap and the fix sit side by side.

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

At stage 3 the classic ReBAC model stops agreeing with the others. This is not a bug in the comparison: `check(user, relation, object)` has three arguments and none of them can carry a time of day.

The fifth engine shows how that gap was closed. It keeps the classic model's relationships for the grant and adds one OpenFGA-style conditional tuple per document, intersected with it:

```text
define within_hours: [user:* with business_hours]
define editor: (owner or admin from parent) and within_hours

condition business_hours(hour: int) {
  hour >= 9 && hour < 18
}
```

Relationships still decide who may edit; the condition, evaluated against the request context at check time, decides when. With it, the ReBAC model agrees with Cedar, Rego and Casbin on every request. OpenFGA enabled conditional tuples by default in v1.4.0 (December 2023); SpiceDB had shipped the same mechanism earlier, as experimental caveats in v1.14.0 (November 2022). A conditional tuple checked without the context it needs is reported as an error rather than a quiet deny, as OpenFGA does.

The page leads with one question asked at every hour of the day: each engine's answer is drawn as a timing trace, with the hours where they disagree marked in red. Below it, all 72 requests of the stage are laid out by action, resource and hour.

The Rego policy can also be edited on the page. OPA compiles each edit, runs it against every request in the map, and lists the requests whose decision changed from the shipped policy.

## Why the comparison can be trusted

"Send the same request to every engine" is not well defined, because the engines do not share an input model. Cedar takes a fixed `(principal, action, resource, context)` tuple, Rego takes arbitrary JSON, Casbin takes a variable-length tuple matched by an expression, and Zanzibar takes `(user, relation, object)`, with no place in the model for an attribute condition.

So the projections are the interesting part, and their fidelity is verified mechanically. A differential harness enumerates every request the scenario can produce and runs all of them through every engine. A disagreement has only two possible causes:

1. A bug in the projection, which is a defect to fix.
2. A genuine semantic difference between engines, which is the teaching material.

The test suite pins this down: the four context-capable engines (Cedar, Rego, Casbin and ReBAC with conditions) must agree on every request at every stage, and classic ReBAC must be the only engine that ever diverges. The business-hours window is also checked directly at 08, 09, 17 and 18, because agreement alone cannot catch a window every engine got wrong in the same way. If a projection quietly grants something the requirements never asked for, CI fails.

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

| Engine             | How it evaluates                                                       |
| ------------------ | ---------------------------------------------------------------------- |
| Cedar              | Official `@cedar-policy/cedar-wasm` bindings                           |
| OPA / Rego         | OPA compiled to `js/wasm`, so policies are compiled and evaluated live |
| Casbin             | `casbin`, the TypeScript implementation, runs directly                 |
| ReBAC              | A teaching reimplementation of the Zanzibar check algorithm            |
| ReBAC + Conditions | The same reimplementation, with conditional tuples and `and`           |

Neither ReBAC engine is OpenFGA. They reimplement the parts that matter for understanding the model — relation rewrites, tuple-to-userset traversal, intersection and conditional tuples — and are labelled as such in the interface.

## A note on Casbin role definitions

Casbin numbers role definitions consecutively from `g`, and `loadSection` stops at the first missing index. A model that declares `g2` without also declaring `g` therefore never registers the grouping at all, and the matcher ends up calling a function that was never installed. Go Casbin contains the same loop, so this is a naming constraint rather than an implementation defect. It was reported upstream against the Go implementation in 2018 and closed as the expected convention, with the maintainer noting that supporting arbitrary names would be a reasonable improvement. Only one grouping is needed here, so it is named `g`.

## Contributing

Issues and pull requests are welcome. CI runs Prettier, ESLint, tsc, the differential
harness, the production build, gofmt and go vet. A Claude review runs on pull requests
as well, aimed at what the tests cannot see: a projection that grants something the
requirements never asked for, an expressiveness rating the code does not justify, or a
factual claim in the copy.

## Licence

MIT
