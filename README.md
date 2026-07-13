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
- [Importing acceptance criteria from DevOps](#importing-acceptance-criteria-from-devops)
  - [Customizing the parsing process](#customizing-the-parsing-process)
- [Reporting](#reporting)
  - [The Vitest reporter](#the-vitest-reporter)
  - [Standalone reporters](#standalone-reporters)
  - [Debugging a failed scenario](#debugging-a-failed-scenario)
  - [Error verbosity](#error-verbosity)
  - [Execution logs in reports](#execution-logs-in-reports)
  - [Attachments in reports](#attachments-in-reports)
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
      name: "registered user exists",
      type: "given",
      execute: (context) => {
        context.user = { username: "alice" };
      },
    },
    {
      name: "credentials are submitted",
      type: "when",
      execute: async (context) => {
        context.response = { status: 200, token: "token-123" };
      },
    },
    {
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

Ids are optional everywhere they can be derived: a step without an `id` gets one slugified from its `name` (`"a cart with two items"` → `a-cart-with-two-items`), and a scenario without an `id` gets one slugified from its `title`. Steps in the same scenario that end up with the same id are disambiguated with their 1-based occurrence (`pay-1`, `pay-2`). Provide explicit ids when a name is expected to change but the id must stay stable (e.g. for `dependsOn` or report-history comparisons).

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

`scenario()` is a thin wrapper producing the same immutable model, if you prefer chaining over one literal. Every step method accepts a `(name, execute)` shorthand, and the scenario id can be omitted (it is derived from the title):

```ts
import { scenario } from "@avesbox/magpie";

const login = scenario<{ response?: { status: number; token?: string } }>("Registered user logs in")
  .acceptance("AUTH-001")
  .tag("auth", "critical")
  .given("registered user exists", () => undefined)
  .when("credentials are submitted", (context) => {
    context.response = { status: 200, token: "token-123" };
  })
  .then("token is returned", (context) => {
    if (!context.response?.token) throw new Error("Expected a token");
  })
  .build();
```

The object form is still available when a step needs an explicit `id`, `metadata`, or a custom `lifecycle` — `.given({ id: "given-user", name: "registered user exists", execute: ... })`. The builder also exposes `.setup()`, `.cleanup()`, `.step()` (raw step input), `.description()`, `.dependsOn()`, and `.metadata()`.

### Sub-scenarios

A scenario with more than one `given` step is automatically split into independent sub-scenarios: each `given` starts a new sub-scenario made up of that `given` and every step up to (but excluding) the next `given`, plus any steps before the first `given` (e.g. `setup`). Sub-scenarios run independently — each gets a fresh context and its own result — but if any sub-scenario fails, the parent scenario is reported as failed.

The split can be disabled per scenario with `splitOnGiven: false` (or `.splitOnGiven(false)` on the builder, or the `splitOnGiven` option on the Gherkin importer): all steps then run as one linear scenario sharing a single context, and no sub-scenario ids are generated. In Gherkin, only explicit repeated `Given` keywords split — `And`/`But` continuation steps never do.

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

**The easiest way to pass these flags is the `magpie` CLI**, a thin wrapper installed with the package. It extracts the Magpie flags, converts them to `MAGPIE_*` environment variables (the transport that reliably reaches Vitest's worker processes), and forwards everything else to Vitest unchanged — no `--` passthrough needed:

```bash
npx magpie run --tag auth
npx magpie run --coverage --acceptance "AUTH-*"
npx magpie watch --story Authentication
```

Environment variables work everywhere too, including through npm scripts: `MAGPIE_TAGS=auth npm test`.

If you call Vitest directly instead, its CLI rejects flags it does not know, so Magpie flags must come after a `--` that reaches Vitest — `vitest run -- --tag auth`, or through npm: `npm test -- -- --tag auth`.

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

### Step registries and feature discovery

For anything beyond a single feature, define steps once in a shared registry and load a whole directory of `.feature` files:

```ts
// steps/registry.ts — modules add their steps to one shared registry
import { createGherkinStepRegistry } from "@avesbox/magpie";

export const steps = createGherkinStepRegistry<{ user?: string }>();

steps
  .define({
    expression: "a registered user {string}",
    execute: ({ arguments: [username], context }) => {
      context.user = String(username);
    },
  })
  .define({
    expression: "the login succeeds",
    execute: () => undefined,
  });
```

```ts
// features.acceptance.test.ts — one story per .feature file, recursively
import { createGherkinStoriesFromDirectory, registerFilteredStory, resolveScenarioFilter } from "@avesbox/magpie";
import { steps } from "./steps/registry.js";

const stories = await createGherkinStoriesFromDirectory("./features", { stepDefinitions: steps });
const filter = resolveScenarioFilter({ argv: process.argv.slice(2), env: process.env });

for (const story of stories) {
  registerFilteredStory(story, { filter, reportToVitest: true });
}
```

Registries are mergeable (`registry.merge(other)`, `registry.add(...defs)`) and accepted anywhere `stepDefinitions` takes an array. `findFeatureFiles(directory)` is exported separately if you need the file list; discovery throws when a directory contains no feature files, so an empty suite never passes silently.

### Undefined step snippets

When feature text references steps that have no matching definition, the importer fails upfront with **every** undefined step of the feature and a ready-to-paste snippet for each:

```text
2 Gherkin step(s) in auth.feature have no matching step definition:

  - a registered user "alice"
  - the login succeeds

Implement them with:

defineGherkinStep({
  expression: "a registered user {string}",
  execute: ({ arguments: [string1], context }) => {
    throw new Error("Step not implemented yet");
  },
});
...
```

Quoted values are suggested as `{string}`, whole numbers as `{int}`, decimals as `{float}`. `generateGherkinStepSnippet(text)` is exported for tooling.

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

## Importing acceptance criteria from DevOps

Work items in tools like Azure DevOps carry their Acceptance Criteria as **HTML** (the rich-text editor's storage format) or, if a team pastes it directly, plain **Markdown**. `createScenariosFromAcceptanceCriteria` reads either — both are normalized to the same plain text before parsing, so a bullet list renders identically whether it arrived as `<ul><li>` or `-`:

```ts
import { createScenariosFromAcceptanceCriteria } from "@avesbox/magpie";

const acceptanceCriteria = /* the work item's Acceptance Criteria field, HTML or Markdown */ `
  <p><strong>Scenario: Successful login</strong></p>
  <ul>
    <li>Given a registered user exists</li>
    <li>When they submit valid credentials</li>
    <li>Then a token is returned</li>
  </ul>
`;

const scenarios = createScenariosFromAcceptanceCriteria(acceptanceCriteria, {
  title: "User login",
  workItemId: "AUTH-1234",
  stepDefinitions,
});
```

The default parser reads `Given`/`When`/`Then`/`And`/`But` bullet lines (optionally grouped under `Scenario: <title>` headings) and — reusing the Gherkin importer under the hood — resolves each step against `stepDefinitions` exactly like a `.feature` file would, so the same step registry works for both. `workItemId` tags every generated scenario with `@<workItemId>`, which flows through the existing Gherkin acceptance-tag extraction (`acceptanceTagPrefix` / `acceptanceTagPattern`, both accepted here too) for free.

Content with more than one `Scenario:` heading — or more than one `Given` when headings are absent — returns **a list of scenarios**, one per block; content with a single block still returns a one-element list, so callers never need to branch on shape.

### Customizing the parsing process

Not every team writes acceptance criteria as Given/When/Then. Pass `parser` to fully replace the default: it receives the normalized (HTML/Markdown-agnostic) text plus the same import options, and may return a single `Scenario` or a list — both are accepted:

```ts
const scenarios = createScenariosFromAcceptanceCriteria(acceptanceCriteria, {
  stepDefinitions,
  parser: (normalizedText, options) => {
    // e.g. a team that writes plain checklists instead of Given/When/Then
    return myOwnParser(normalizedText).map((block) => defineScenario({ ...block, ... }));
  },
});
```

`normalizeAcceptanceCriteriaContent(content, contentType?)` is exported separately if you only need the HTML/Markdown normalization step (content type is auto-detected from the presence of HTML tags when omitted).

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
- pass `junitOutputFile` (and optionally `junitSuiteName`) to also write a JUnit XML report for the test-result panes of Jenkins, GitLab, Azure DevOps, and similar CI systems
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

`createJsonReporter({ outputPath })`, `createHtmlReporter({ outputPath })`, and `createJUnitReporter({ outputPath })` are drop-in equivalents that write a JSON artifact, a self-contained HTML page (inline CSS, no external dependencies), or a JUnit XML file on `flush()`. In the JUnit output each story becomes a `<testsuite>` and each scenario a `<testcase>`; failed quarantined scenarios are reported as skipped so they do not fail the CI stage. They share the recorded entries API, so one execution pass can feed several reporters:

```ts
for (const entry of reporter.entries) {
  jsonReporter.recordScenario(entry.scenario, entry.result);
}
await jsonReporter.flush();
```

Lower-level building blocks are exported too: `buildExecutionRunReport()`, `createStoryReport()`, `formatExecutionRunReport()`, `formatExecutionRunReportAsHtml()`, `formatExecutionRunReportAsJUnitXml()`, `writeHtmlReport()`, `writeJUnitReport()`, and `writeJsonReport()`.

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

Only steps that actually ran appear in `result.steps` — steps after the failure are not executed; cleanup steps are appended after the failure. **Reports** still show the scenario's full declared shape: steps that never ran are rendered as skipped (`○` in the text and HTML output, status `"skipped"` in JSON, counted in `skippedStepCount`), so a failing scenario never looks like it "lost" steps:

```text
  Scenario
    Registered user logs in
      ✓ given registered user exists
      ✗ when credentials are submitted
        ↳ Login service unavailable
      ○ then token is returned
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

The HTML report always keeps the full error too, independent of this option: every `StepReport`/`ScenarioReport` carries an `errorDetail` field with the full stack, and the HTML renderer shows it in a collapsible `<details>` under the one-line summary. `error` (used by the text/JSON/JUnit output) still respects `errors.verbose` as above.

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

### Attachments in reports

Steps can attach a file through the execution API — a screenshot, a trace, a log dump:

```ts
execute: (context, api) => {
  api.attach("screenshot.png", screenshotBuffer);
  api.attach("trace.zip", { path: "/tmp/trace.zip" });
  api.attach("notes.txt", "some diagnostic text", "text/plain");
},
```

`attach(name, body, contentType?)` takes inline content (`string` or `Uint8Array`) or a reference to a file already on disk (`{ path }`). `contentType` is inferred from `name`'s extension (`.png`, `.jpg`/`.jpeg`, `.webm`, `.zip`, `.json`, `.txt`) when omitted, falling back to `application/octet-stream`.

Attachments are always captured on the execution result; to include them in reports, enable `attachments: { enabled: true }`:

```ts
const reporter = createHtmlReporter({
  outputPath: "report.html",
  attachments: { enabled: true, directory: "report-attachments" },
});
```

Inline bodies are written as files under `directory` (defaults to `"attachments"`, relative to the process cwd); `{ path }` attachments are referenced as-is. Each step report then carries an `attachments` array of `{ name, contentType, path }`. The HTML reporter renders images inline and other attachments as a download link; the console reporter prints one `📎 name (path)` line per attachment; the JUnit reporter emits `[[ATTACHMENT|path]]` in `<system-out>`, the convention Jenkins/GitLab already parse.

Like `errors` and `logs`, this works with every reporter and with the bridge: `reportToVitest: { attachments: { enabled: true } }`.

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

### Loading acceptance ids from a file

Hardcoding `expectedAcceptanceIds` drifts as requirements change. `loadAcceptanceIds(filePath)` reads them from a `.json` file (a bare `["AUTH-001", ...]` array) or a `.csv`/text export (one id per line; a header row like "Issue key" is skipped, first column used if the line has commas) — the shape a Jira or Azure Boards issue-key export already has once you keep just the id column:

```ts
import { createConsoleReporter, loadAcceptanceIds } from "@avesbox/magpie";

const reporter = createConsoleReporter({
  expectedAcceptanceIds: await loadAcceptanceIds("./requirements/AUTH.csv"),
});
```

## Recipes

Short answers to "how do I ...":

- **Run only critical scenarios locally** — `npx magpie run --tag critical` (with `registerFilteredStory` + `resolveScenarioFilter` wired as shown [above](#filtering-from-the-cli)).
- **Show scenario results in the CI test pane (Jenkins, GitLab, Azure DevOps)** — pass `junitOutputFile: ".magpie/reports/junit.xml"` to `magpiePlugin()` and point the CI test-report step at that file.
- **Retry a flaky scenario** — `retries: 2` on the scenario, or `{ retries: 1 }` in adapter/engine options as a suite-wide default.
- **Stop a known-flaky scenario from breaking CI without deleting it** — add `tags: ["quarantine"]`; it keeps running and reporting, but no longer fails the run.
- **See full stack traces in reports** — `errors: { verbose: true }` in reporter options (or `reportToVitest: { errors: { verbose: true } }`).
- **Attach request/response details to a report** — call `api.log("response", data)` inside the step, and enable `logs: { enabled: true }` in the reporter.
- **Reuse a step across scenarios** — create it once with `defineStep({...})` and reference it from several scenarios' `steps` arrays; scenarios are data, so sharing is plain object reuse.
- **Order scenarios that depend on each other** — `dependsOn: ["other-id"]` + `executeScenarios()`; dependents are skipped automatically when a prerequisite fails.
- **Guarantee teardown always runs** — declare the step with `type: "cleanup", lifecycle: "cleanup"` (or `.cleanup()` in the builder); cleanup runs even after a failure.
- **Use several `given` steps without splitting the scenario** — `splitOnGiven: false` on the scenario (or `.splitOnGiven(false)`, or the importer option); all steps then share one context and run linearly.
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

Implemented today: immutable scenario/story model, runner-agnostic engine with dependencies, retries, and quarantine; Vitest adapter and reporter; `magpie` CLI wrapper; Gherkin importer with stable ids, step registries, directory discovery, and undefined-step snippets; filtering; console/JSON/HTML/JUnit reporting with acceptance traceability. Not implemented yet: live dashboards, Playwright or other non-Vitest adapters.
