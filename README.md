# Magpie

Magpie is an acceptance-scenario framework built on top of [Vitest](https://vitest.dev).

It is not an assertion library and it does not replace Vitest. Its job is to model acceptance criteria as immutable scenario data, execute them through a runner-agnostic engine, and report the results with traceability back to requirements — so "which requirements are actually covered, and did they pass?" has an answer your CI can print.

```text
Scenario data ──▶ execution engine ──▶ Vitest adapter ──▶ reporters (console / JSON / HTML)
      ▲                                                        │
      └── Gherkin .feature files (optional) ───────────────────┘ traceability back to acceptance ids
```

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Defining scenarios](#defining-scenarios)
  - [Typed context](#typed-context)
  - [Step types and lifecycle](#step-types-and-lifecycle)
  - [The fluent builder](#the-fluent-builder)
  - [Sub-scenarios](#sub-scenarios)
- [Running scenarios](#running-scenarios)
  - [Through Vitest](#through-vitest)
  - [Filtering from the CLI](#filtering-from-the-cli)
  - [Directly through the engine](#directly-through-the-engine)
  - [Batch execution and dependencies](#batch-execution-and-dependencies)
- [Gherkin and Cucumber](#gherkin-and-cucumber)
  - [Scenario Outlines and stable ids](#scenario-outlines-and-stable-ids)
- [Reporting](#reporting)
  - [The Vitest reporter](#the-vitest-reporter)
  - [Standalone reporters](#standalone-reporters)
  - [Debugging a failed scenario](#debugging-a-failed-scenario)
  - [Error verbosity](#error-verbosity)
  - [Execution logs in reports](#execution-logs-in-reports)
- [Retries and quarantine](#retries-and-quarantine)
- [Hooks](#hooks)
- [Acceptance traceability](#acceptance-traceability)
- [Recipes](#recipes)
- [Contributing](#contributing)

## Installation

```bash
npm install --save-dev @avesbox/magpie vitest
```

Vitest (`>=4 <5`) is an optional peer dependency: it is required for the Vitest adapter and reporter, but the scenario model, execution engine, Gherkin importer, and standalone reporters work without it.

## Quick start

Three files get you from zero to a passing acceptance report.

**1. Wire the reporter** — `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { magpiePlugin } from "@avesbox/magpie";

export default defineConfig({
  plugins: [
    magpiePlugin({
      jsonOutputFile: ".magpie/reports/latest.json",
    }),
  ],
});
```

**2. Write a scenario** — `login.acceptance.test.ts`:

```ts
import { defineAcceptanceScenario, registerScenario } from "@avesbox/magpie";

interface LoginContext {
  user?: { username: string };
  response?: { status: number; token?: string };
}

const login = defineAcceptanceScenario<LoginContext>({
  id: "auth-login",
  title: "Registered user logs in",
  acceptance: ["AUTH-001"],
  tags: ["auth", "critical"],
  story: { title: "Authentication" },
  steps: [
    {
      id: "given-user",
      name: "registered user exists",
      type: "given",
      execute: (context) => {
        context.user = { username: "alice" };
      },
    },
    {
      id: "when-login",
      name: "credentials are submitted",
      type: "when",
      execute: async (context) => {
        context.response = { status: 200, token: "token-123" };
      },
    },
    {
      id: "then-token",
      name: "token is returned",
      type: "then",
      execute: (context) => {
        if (!context.response?.token) {
          throw new Error("Expected a token");
        }
      },
    },
  ],
});

registerScenario(login, { reportToVitest: true });
```

**3. Run it:**

```bash
npx vitest run
```

Vitest runs the scenario as a regular `describe`/`it` block, and the Magpie reporter prints an acceptance summary at the end of the run and writes `.magpie/reports/latest.json`:

```text
Execution Report
  Scenarios: 1/1 passed
  Steps: 3/3 passed
  Duration: 2ms

Story
  Authentication

  Scenario
    Registered user logs in
      ✓ given registered user exists
      ✓ when credentials are submitted
      ✓ then token is returned

Acceptance
  Implemented: AUTH-001
  Missing: none
```

From here: [filter scenarios from the CLI](#filtering-from-the-cli), [import Gherkin `.feature` files](#gherkin-and-cucumber), [add an HTML report](#the-vitest-reporter), or [track which acceptance ids are still missing](#acceptance-traceability).

## Core concepts

| Concept | What it is | Where it appears |
| --- | --- | --- |
| **Scenario** | An immutable, executable acceptance criterion: id, title, tags, acceptance ids, and ordered steps. | `defineAcceptanceScenario()`, `scenario()` builder |
| **Step** | One unit of work inside a scenario (`given`/`when`/`then`/`setup`/`cleanup`). Failing = throwing. | `steps: [...]`, `defineStep()` |
| **Context** | A plain object threaded through every step of one scenario execution. You type it. | `execute: (context, api) => ...` |
| **Story** | A named group of scenarios (maps to a Gherkin `Feature`). | `defineStory()` |
| **Acceptance id** | A requirement reference (e.g. `AUTH-001`) attached to scenarios; reports show which ids are implemented and which are missing. | `acceptance: [...]`, traceability report |
| **Reporter** | Collects scenario results and emits console text, JSON, or HTML. | `magpiePlugin()`, `createConsoleReporter()`, ... |

Description, execution, and reporting are deliberately separate: scenarios are pure data, so the same scenario can run through Vitest today and through another runner tomorrow, and reports are built from results rather than from runner internals.

## Defining scenarios

### Typed context

Every scenario execution starts from a context object shared by its steps. Type it via the generic parameter — steps get full inference:

```ts
import { defineAcceptanceScenario } from "@avesbox/magpie";

interface CheckoutContext {
  cart?: { items: number };
  receipt?: { total: number };
}

const checkout = defineAcceptanceScenario<CheckoutContext>({
  id: "checkout-happy-path",
  title: "Customer checks out",
  acceptance: ["SHOP-042"],
  steps: [
    {
      id: "given-cart",
      name: "a cart with two items",
      type: "given",
      execute: (context) => {
        context.cart = { items: 2 };
      },
    },
    {
      id: "then-receipt",
      name: "a receipt is produced",
      type: "then",
      execute: (context, api) => {
        api.log("cart at checkout", context.cart); // shows up in results and (optionally) reports
        if (!context.cart) throw new Error("no cart");
        context.receipt = { total: 42 };
      },
    },
  ],
});
```

Steps receive `(context, api)` where `api.log(message, data?)` records structured diagnostics onto the execution result (see [Execution logs in reports](#execution-logs-in-reports)).

### Step types and lifecycle

The standard step types are `setup`, `given`, `when`, `then`, and `cleanup`. All are ordinary steps — the type is metadata used for reporting and sub-scenario splitting — except `cleanup`, which has a distinct lifecycle: cleanup steps **always run**, even when a main step failed, and are appended to the result after the failure. Use them for teardown that must not be skipped:

```ts
steps: [
  { id: "given-db", name: "database is seeded", type: "given", execute: seed },
  { id: "then-query", name: "query returns rows", type: "then", execute: assertRows },
  { id: "cleanup-db", name: "database is wiped", type: "cleanup", lifecycle: "cleanup", execute: wipe },
]
```

Custom step types can be registered with `createStepTypeRegistry()` / `standardStepTypes.extend()` if your domain needs more than the Gherkin five.

### The fluent builder

`scenario()` is a thin wrapper producing the same immutable model, if you prefer chaining over one literal:

```ts
import { scenario } from "@avesbox/magpie";

const login = scenario<{ response?: { status: number; token?: string } }>(
  "auth-login",
  "Registered user logs in",
)
  .acceptance("AUTH-001")
  .tag("auth", "critical")
  .given({ id: "given-user", name: "registered user exists", execute: () => undefined })
  .when({
    id: "when-login",
    name: "credentials are submitted",
    execute: (context) => {
      context.response = { status: 200, token: "token-123" };
    },
  })
  .then({
    id: "then-token",
    name: "token is returned",
    execute: (context) => {
      if (!context.response?.token) throw new Error("Expected a token");
    },
  })
  .build();
```

The builder also exposes `.setup()`, `.cleanup()`, `.step()` (raw step input), `.description()`, `.dependsOn()`, and `.metadata()`.

### Sub-scenarios

A scenario with more than one `given` step is automatically split into independent sub-scenarios: each `given` starts a new sub-scenario made up of that `given` and every step up to (but excluding) the next `given`, plus any steps before the first `given` (e.g. `setup`). Sub-scenarios run independently — each gets a fresh context and its own result — but if any sub-scenario fails, the parent scenario is reported as failed.

Each sub-scenario gets an acceptance id derived from the parent's by appending a two-digit index (`AC-001` → `AC-001-01`, `AC-001-02`, ...). Override per `given` with the second argument:

```ts
const checkout = scenario<{ status?: number }>("checkout", "Checkout flows")
  .acceptance("AC-001")
  .given({ id: "given-valid-card", name: "customer has a valid card", execute: () => undefined }) // -> AC-001-01
  .when({ id: "when-pay", name: "customer pays", execute: () => undefined })
  .then({ id: "then-success", name: "payment succeeds", execute: () => undefined })
  .given(
    { id: "given-expired-card", name: "customer has an expired card", execute: () => undefined },
    { acceptance: "AC-001-EXPIRED" }, // custom id instead of AC-001-02
  )
  .when({ id: "when-pay-2", name: "customer pays", execute: () => undefined })
  .then({ id: "then-decline", name: "payment is declined", execute: () => undefined })
  .build();
```

`ScenarioExecutionResult.subScenarios` and `ScenarioReport.subScenarios` expose per-sub-scenario results, and traceability reports use the granular sub-scenario ids instead of the parent's when present.

## Running scenarios

### Through Vitest

The adapter maps scenario data onto `describe()` and `it()`:

```ts
import { registerScenario, registerStory, defineStory } from "@avesbox/magpie";

registerScenario(login, { reportToVitest: true });

// or group scenarios into a story:
const story = defineStory({ title: "Authentication", scenarios: [login] });
registerStory(story, { reportToVitest: true });
```

`reportToVitest: true` records each result for the [Magpie Vitest reporter](#the-vitest-reporter); a failing scenario throws the original error inside its `it()` block, so Vitest's own failure output (stack trace, diff) still appears alongside the Magpie report.

The adapter options also accept `hooks`, `context`/`createContext`, `retries`, `quarantineTags`, an `executor` override, and a `filter`:

### Filtering from the CLI

`registerFilteredStory()` plus `resolveScenarioFilter()` turn CLI flags and environment variables into a scenario filter:

```ts
import { defineStory, registerFilteredStory, resolveScenarioFilter } from "@avesbox/magpie";

const story = defineStory({ title: "Authentication", scenarios: [login] });

registerFilteredStory(story, {
  filter: resolveScenarioFilter({ argv: process.argv.slice(2), env: process.env }),
  reportToVitest: true,
});
```

| CLI flag | Environment variable | Matches |
| --- | --- | --- |
| `--tag auth` | `MAGPIE_TAGS=auth,critical` | scenario tags |
| `--acceptance AUTH-*` | `MAGPIE_ACCEPTANCE=AUTH-*` | acceptance ids (glob `*` supported) |
| `--story Authentication` | `MAGPIE_STORY=Authentication` | story title |
| `--scenario "Registered user logs in"` | `MAGPIE_SCENARIO=...` | scenario title |
| `--regex critical` / `--grep critical` | `MAGPIE_REGEX=critical` | id, title, description, tags, acceptance, story |

Because Vitest's CLI rejects flags it does not know, Magpie flags must come after a `--` that reaches Vitest — `vitest run -- --tag auth`, or through npm: `npm test -- -- --tag auth`.

For programmatic filtering, build a filter object directly:

```ts
import { filterScenarios } from "@avesbox/magpie";

const critical = filterScenarios(story.scenarios, { tags: ["critical"] });
```

### Directly through the engine

No Vitest required — `executeScenario()` returns a rich result:

```ts
import { executeScenario } from "@avesbox/magpie";

const result = await executeScenario(login, {
  createContext: () => ({}),
});

result.success;       // boolean
result.steps;         // per-step status, duration, logs, error
result.failure;       // which step threw, serialized error, original cause
result.logs;          // everything emitted via api.log
```

### Batch execution and dependencies

`executeScenarios()` runs a set with dependency-aware scheduling:

```ts
import { executeScenarios } from "@avesbox/magpie";

const batch = await executeScenarios([seedInventory, loadPricing, openCheckout], {
  maxConcurrency: 2,
  createContext: () => ({}),
});

batch.results; // finished scenarios, in input order
batch.skipped; // scenarios skipped because a dependency failed
```

Declare dependencies with `dependsOn: ["other-scenario-id"]`. Independent scenarios run in parallel up to `maxConcurrency`, dependents wait for all prerequisites, and downstream scenarios are skipped (with `reason: "dependency_failed"`) when an upstream fails. Cycles and references to missing ids throw upfront. For parallel runs, prefer `createContext()` so each scenario gets its own context object — a shared `context` with `maxConcurrency > 1` is rejected.

## Gherkin and Cucumber

Generate Magpie scenarios from Gherkin feature text and resolve steps with [Cucumber expressions](https://github.com/cucumber/cucumber-expressions):

```ts
import { createGherkinStory, defineGherkinStep, registerFilteredStory } from "@avesbox/magpie";

const story = createGherkinStory(
  `
Feature: Authentication

  @auth @AUTH-001
  Scenario: Registered user logs in
    Given a registered user "alice"
    When the user logs in with password secret
    Then the response status is 200
`,
  {
    uri: "authentication.feature",
    stepDefinitions: [
      defineGherkinStep({
        expression: "a registered user {string}",
        execute: ({ arguments: [username], context }) => {
          context.user = username;
        },
      }),
      defineGherkinStep({
        expression: "the user logs in with password {word}",
        execute: ({ arguments: [password], context }) => {
          context.response = { status: password === "secret" ? 200 : 401 };
        },
      }),
      defineGherkinStep({
        expression: "the response status is {int}",
        execute: ({ arguments: [status], context }) => {
          if (context.response?.status !== status) {
            throw new Error("Unexpected response status");
          }
        },
      }),
    ],
  },
);

registerFilteredStory(story, { reportToVitest: true });
```

Or load `.feature` files from disk with `createGherkinStoryFromFile(filePath, options)` / `createGherkinScenariosFromFile(filePath, options)`.

The importer:

- includes `Background` steps (feature- and rule-level) in every scenario
- preserves doc strings and data tables — available to step definitions as `argumentData.docString` / `argumentData.dataTable` and in step metadata
- maps `Rule:` blocks to stories
- extracts acceptance ids from tags by prefix (default `AUTH-`, override with `acceptanceTagPrefix`), by tag pattern, or from description text:

```ts
const story = await createGherkinStoryFromFile("./features/payments.feature", {
  acceptanceTagPattern: /acceptance\(([^)]+)\)/, // @acceptance(PAY-123)
  acceptanceMetadataPattern: /PAY-\d+/g,          // "Acceptance: PAY-123" in descriptions
  stepDefinitions,
});
```

### Scenario Outlines and stable ids

`Scenario Outline` / `Examples` tables are fully expanded: each example row becomes an independent Magpie scenario with `<placeholders>` substituted in the title and step texts, and tags on the `Examples:` block (including acceptance tags) are inherited by the generated scenarios.

Generated scenario ids are **stable and deterministic** — derived from the feature and scenario names rather than from the parser's random per-run ids:

```text
Feature: Withdrawals                        id
  Scenario: Balance is shown            →   withdrawals:balance-is-shown
  Scenario Outline: Withdraw <amount>   →   withdrawals:withdraw-20
    Examples: | amount | → 20, 50       →   withdrawals:withdraw-50
```

When several generated scenarios share a name (an outline whose title has no placeholder, or two scenarios named identically), every occurrence is disambiguated with its 1-based position — ids become `withdrawals:withdraw-from-account:1`, `:2`, ... and titles become `Withdraw from account #1`, `#2`, ... Step ids are positional (`<scenario-id>:step-1`).

Because ids survive re-parsing, they are safe to use in `dependsOn`, in id-based filtering, and for comparing archived report runs. Note that ids are derived from names: renaming a feature or scenario changes its id, which is the intended trade-off (the id follows the requirement, not the file).

## Reporting

### The Vitest reporter

Vitest has no auto-discovery for reporters — `test.reporters` is a plain array read from your config — so Magpie ships both the reporter and a Vite plugin that wires it for you.

**Option 1: `magpiePlugin()` (recommended).** Its `config()` hook merges a `MagpieVitestReporter` into `test.reporters`, composing with reporters you already list:

```ts
import { defineConfig } from "vitest/config";
import { magpiePlugin } from "@avesbox/magpie";

export default defineConfig({
  plugins: [
    magpiePlugin({
      jsonOutputFile: ".magpie/reports/latest.json",
      jsonArchiveDirectory: ".magpie/reports/history",
    }),
  ],
});
```

**Option 2: `createMagpieVitestReporter()` directly**, if you control the `reporters` array yourself:

```ts
import { defineConfig } from "vitest/config";
import { createMagpieVitestReporter } from "@avesbox/magpie";

export default defineConfig({
  test: {
    reporters: [
      "default",
      createMagpieVitestReporter({ jsonOutputFile: ".magpie/reports/latest.json" }),
    ],
  },
});
```

Either way, once configured:

- the acceptance report is printed at the end of every run
- a JSON artifact is written to `jsonOutputFile`, and every run is archived under `jsonArchiveDirectory` (default: `history/` next to the output file), keeping the 3 most recent by default (`jsonHistoryLimit`)
- pass `htmlOutputFile` (and optionally `htmlArchiveDirectory`, `htmlHistoryLimit`) to also write a self-contained HTML report, archived the same way
- suites participate by passing `reportToVitest: true` (or an options object) to `registerScenario` / `registerStory` / `registerFilteredStory`

To make the HTML report opt-in from the command line, gate it on `isOutputEnabled()` in your config:

```ts
import { isOutputEnabled } from "@avesbox/magpie";

const htmlEnabled = isOutputEnabled("html", { argv: process.argv, env: process.env });
// vitest run -- --output html    or    MAGPIE_OUTPUT=html npm test
```

(As with filter flags, `--output` must come after the `--` that reaches Vitest, so through npm it is `npm test -- -- --output html`.)

### Standalone reporters

Outside Vitest, reporters collect results incrementally and emit a final run report:

```ts
import {
  createConsoleReporter,
  createJsonReporter,
  createHtmlReporter,
  createReportingHooks,
  defineStory,
  executeScenario,
} from "@avesbox/magpie";

const story = defineStory({ title: "Authentication", scenarios: [login] });

const reporter = createConsoleReporter({
  stories: [story],
  expectedAcceptanceIds: ["AUTH-001", "AUTH-007"],
});

for (const scenario of story.scenarios) {
  await executeScenario(scenario, { hooks: createReportingHooks(reporter) });
}

const report = await reporter.flush(); // prints the text report, returns the ExecutionRunReport
```

`createJsonReporter({ outputPath })` and `createHtmlReporter({ outputPath })` are drop-in equivalents that write a JSON artifact or a self-contained HTML page (inline CSS, no external dependencies) on `flush()`. They share the recorded entries API, so one execution pass can feed several reporters:

```ts
for (const entry of reporter.entries) {
  jsonReporter.recordScenario(entry.scenario, entry.result);
}
await jsonReporter.flush();
```

Lower-level building blocks are exported too: `buildExecutionRunReport()`, `createStoryReport()`, `formatExecutionRunReport()`, `formatExecutionRunReportAsHtml()`, `writeHtmlReport()`, and `writeJsonReport()`.

### Debugging a failed scenario

When a step throws, execution stops after that step (cleanup steps still run) and the failure is captured on the result:

```ts
const result = await executeScenario(login);

// result.success === false
// result.failure === {
//   step: { id: "then-token", name: "token is returned", ... },
//   error: { name: "Error", message: "Expected a token", stack: "..." },
//   cause: Error: Expected a token       // the original thrown value
// }
```

Only steps that actually ran appear in `result.steps` — steps after the failure are omitted rather than marked "skipped"; cleanup steps are appended after the failure. The text report prints the failing step's error inline:

```text
  Scenario
    Registered user logs in
      ✓ given registered user exists
      ✗ then token is returned
        ↳ Expected a token
```

and the JSON artifact carries the same information structurally, with `error` on both the failing step and the scenario.

### Error verbosity

By default reports contain only the **first line** of an error message. Enable `errors: { verbose: true }` to include the full error (stack trace when available):

```ts
const reporter = createConsoleReporter({
  errors: { verbose: true },
});
```

The option is part of `ReportBuildOptions`, so it works identically with `createJsonReporter`, `createHtmlReporter`, `buildExecutionRunReport`, and — for reports assembled by the Magpie Vitest reporter — via the adapter's bridge options: `reportToVitest: { errors: { verbose: true } }`.

### Execution logs in reports

Steps can emit diagnostics through the execution API (`api.log(message, data?)`). Logs are always captured on the execution result; to also include them in reports, enable `logs: { enabled: true }`:

```ts
const reporter = createConsoleReporter({
  logs: { enabled: true },
});
```

Each step report then carries its own `logs` array (message, timestamp, optional structured `data`), and the scenario report carries scenario-level entries (such as the engine's `scenario.started` / `scenario.finished` markers). The console and HTML reporters render step logs beneath each step:

```text
✓ when credentials are submitted
  · fetching token {"url":"https://api.example.test/login"}
  · token received
```

Like `errors`, this works with every reporter and with the bridge: `reportToVitest: { logs: { enabled: true } }`.

## Retries and quarantine

### Retries

A scenario can declare how many times a failing execution is retried before being reported as failed:

```ts
const checkout = defineAcceptanceScenario({
  id: "checkout",
  title: "Checkout completes",
  retries: 2, // up to 3 attempts in total
  steps: [/* ... */],
});
```

A default for scenarios without their own `retries` can be set at execution time — `executeScenario(scenario, { retries: 1 })` or via the adapter options — and a scenario-level `retries` always wins. When a scenario has sub-scenarios, each sub-scenario is retried independently, so a stable sub-scenario is not re-run because a sibling flaked.

The result reflects the last attempt and carries `attempts` when more than one ran; reports show `[attempts: N]` next to the scenario title. `afterScenario` hooks (including reporting hooks) fire once per scenario with the final result, not once per attempt. When a shared `context` object is passed explicitly, retried attempts reuse it as-is; use `createContext` for a fresh context per attempt.

### Quarantine

Tag a scenario `quarantine` to keep it running and reported without letting its failure break the build:

```ts
const flaky = defineAcceptanceScenario({
  id: "flaky-search",
  title: "Search returns suggestions",
  tags: ["quarantine"],
  steps: [/* ... */],
});
```

In the Vitest adapter, a failing quarantined scenario no longer throws inside its `it()` block, so the run stays green. Reports mark it with `quarantined: true` and `[quarantined]` in the text output, and totals count it separately: quarantined scenarios are excluded from both `passedScenarioCount` and `failedScenarioCount` and appear in `quarantinedScenarioCount` (`Quarantined: N` in the summary), so `passed + failed + quarantined = total`.

The tag set is configurable everywhere the feature applies — `quarantineTags: ["known-flaky"]` on the adapter options, on `ReportBuildOptions`, or in the bridge options — and defaults to `DEFAULT_QUARANTINE_TAGS` (`["quarantine"]`).

## Hooks

The engine supports `beforeScenario`, `afterScenario`, `beforeStep`, and `afterStep`:

```ts
import { executeScenario } from "@avesbox/magpie";

await executeScenario(login, {
  hooks: {
    beforeScenario: (_scenario, context) => {
      context.started = true;
    },
    beforeStep: (step) => console.log(`starting ${step.name}`),
    afterStep: (step, _context, result) => console.log(`${step.name}: ${result.status}`),
    afterScenario: (_scenario, _context, result) =>
      console.log(result.success ? "scenario passed" : "scenario failed"),
  },
});
```

Combine hook sets with `mergeExecutionHooks()` — each hook runs in order:

```ts
import { createReportingHooks, executeScenario, mergeExecutionHooks } from "@avesbox/magpie";

const hooks = mergeExecutionHooks(createReportingHooks(reporter), {
  beforeScenario: () => console.log("scenario starting"),
});

await executeScenario(login, { hooks });
```

The same `hooks` option is accepted by `executeScenarios()` and by the Vitest adapter functions.

## Acceptance traceability

Give the reporter the full list of acceptance ids you expect to be covered, and the report splits them into implemented and missing:

```ts
const reporter = createConsoleReporter({
  expectedAcceptanceIds: ["AUTH-001", "AUTH-002", "AUTH-007"],
});

// ...record scenarios...

const report = await reporter.flush();
report.traceability.implemented; // e.g. ["AUTH-001", "AUTH-002"]
report.traceability.missing;     // e.g. ["AUTH-007"]
```

To fail CI when requirements have no covering scenario:

```ts
if (report.traceability.missing.length > 0) {
  throw new Error(`Uncovered acceptance criteria: ${report.traceability.missing.join(", ")}`);
}
```

When scenarios have sub-scenarios, traceability uses the granular sub-scenario ids (`AC-001-01`, ...) instead of the parent's, and `createAcceptanceTraceabilityReport(scenarios, expectedIds)` is available for computing the split without running anything.

## Recipes

Short answers to "how do I ...":

- **Run only critical scenarios locally** — `vitest run -- --tag critical` (with `registerFilteredStory` + `resolveScenarioFilter` wired as shown [above](#filtering-from-the-cli)).
- **Retry a flaky scenario** — `retries: 2` on the scenario, or `{ retries: 1 }` in adapter/engine options as a suite-wide default.
- **Stop a known-flaky scenario from breaking CI without deleting it** — add `tags: ["quarantine"]`; it keeps running and reporting, but no longer fails the run.
- **See full stack traces in reports** — `errors: { verbose: true }` in reporter options (or `reportToVitest: { errors: { verbose: true } }`).
- **Attach request/response details to a report** — call `api.log("response", data)` inside the step, and enable `logs: { enabled: true }` in the reporter.
- **Reuse a step across scenarios** — create it once with `defineStep({...})` and reference it from several scenarios' `steps` arrays; scenarios are data, so sharing is plain object reuse.
- **Order scenarios that depend on each other** — `dependsOn: ["other-id"]` + `executeScenarios()`; dependents are skipped automatically when a prerequisite fails.
- **Guarantee teardown always runs** — declare the step with `type: "cleanup", lifecycle: "cleanup"` (or `.cleanup()` in the builder); cleanup runs even after a failure.
- **Keep Gherkin-generated ids usable in `dependsOn` and history diffs** — nothing to do; ids are [stable by construction](#scenario-outlines-and-stable-ids). Just remember renaming a scenario changes its id.
- **Fail the build when a requirement has no scenario** — pass `expectedAcceptanceIds` and check `report.traceability.missing` (see [Acceptance traceability](#acceptance-traceability)).

## Contributing

Project scripts:

- `npm run typecheck` — TypeScript project check
- `npm test` — full Vitest run (unit + acceptance projects)
- `npm run test:unit` / `npm run test:acceptance` — individual Vitest projects
- `npm run test:watch` — watch mode
- `npm run build` — compile to `dist/`

The repository's GitHub Actions workflow runs typecheck and tests, and uploads `.magpie/reports/` as a build artifact — the latest report at `.magpie/reports/latest.json`, with history under `.magpie/reports/history/`.

Implemented today: immutable scenario/story model, runner-agnostic engine with dependencies, retries, and quarantine; Vitest adapter and reporter; Gherkin importer with stable ids; filtering; console/JSON/HTML reporting with acceptance traceability. Not implemented yet: live dashboards, Playwright or other non-Vitest adapters.
