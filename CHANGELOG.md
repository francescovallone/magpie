# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.4] - 2026-07-15

### Fixed

- The acceptance-criteria parser no longer leaks prose punctuation into step texts: a comma directly after the keyword (`Given, ...`) and leading/trailing punctuation around the step text (`, . ; : ! ?`) are stripped before step matching. Trailing quotes are intentionally kept, as they can close a `{string}` argument.

## [0.3.3] - 2026-07-15

### Fixed

- `createScenariosFromAcceptanceCriteria` no longer reports every step as undefined when the content carries rich-text typography: zero-width/format characters (U+00AD, U+200B–U+200D, U+2060, U+FEFF) are stripped, and the Unicode space family, curly quotes/apostrophes, typographic dashes, the ellipsis, and numeric HTML entities (`&#8217;`) are normalized to their plain ASCII equivalents before step matching.
- The "no matching step definition" error now names any non-ASCII code points in each unmatched step (e.g. `U+00A0`), so invisible-character mismatches are diagnosable from the error message alone.

## [0.3.2] - 2026-07-15

### Added

- `ScenarioSkip`: throw it from a step to report the scenario as skipped instead of failed. Skipped scenarios are excluded from passed/failed totals and reported as skipped in JUnit XML.
- Acceptance-test examples for Gherkin (`Scenario Outline`/`Examples`), Playwright hooks, and importing acceptance criteria fetched from a remote source (e.g. DevOps).

## [0.3.0] - 2026-07-13

### Added

- Playwright integration: `createPlaywrightHooks()` manages a browser context and page per scenario (`context.page`), shares one lazily-launched browser across scenarios, and attaches a full-page screenshot to the failing step on failure. No dependency on Playwright — the launch function is passed in.

## [0.2.0] - 2026-07-13

### Added

- Attachments in reports: `api.attach(name, body, contentType?)` captures files (inline content or `{ path }` references) on step results; rendered inline/linked in HTML, as `📎` lines in console output, and as `[[ATTACHMENT|path]]` in JUnit `<system-out>`.
- `createScenariosFromAcceptanceCriteria()`: import acceptance criteria from DevOps work items (Azure DevOps HTML or plain Markdown), with a replaceable `parser` and the shared Gherkin step registry.
- `normalizeAcceptanceCriteriaContent()` exported for standalone HTML/Markdown normalization.

## [0.1.6] - 2026-07-10

### Added

- JUnit XML reporting: `createJUnitReporter()`, `formatExecutionRunReportAsJUnitXml()`, `writeJUnitReport()`, and the `junitOutputFile` plugin option.
- Undefined-step snippets: Gherkin import fails upfront listing every undefined step with a ready-to-paste `defineGherkinStep` snippet.
- Gherkin step registries (`createGherkinStepRegistry()`) and directory discovery (`createGherkinStoriesFromDirectory()`, `findFeatureFiles()`).

### Changed

- Stable, deterministic ids for Gherkin-generated scenarios (derived from feature/scenario names instead of parser-random ids).

## [0.1.5] - 2026-07-09

### Added

- Execution logs in reports: `api.log(message, data?)` entries rendered per step when `logs: { enabled: true }`.

### Fixed

- Gherkin handling improvements (Background steps, doc strings, data tables).
- README corrections.

## [0.1.4] - 2026-07-08

### Fixed

- Sub-scenario results reported correctly.

## [0.1.3] - 2026-07-08

### Fixed

- `dist/` folder preserved in the published package.

## [0.1.2] - 2026-07-08

### Added

- Sub-scenarios: scenarios with multiple `given` steps split into independently executed sub-scenarios with derived acceptance ids (`splitOnGiven: false` to opt out).

## [0.1.1] - 2026-07-07

### Added

- `magpiePlugin()` Vite plugin that wires the Magpie reporter into Vitest config.
- Report history limit (`jsonHistoryLimit`).

### Fixed

- Story metadata merge.

## [0.1.0] - 2026-07-06

### Added

- Initial release: immutable scenario/story model, runner-agnostic engine with dependencies, retries, and quarantine; Vitest adapter and reporter; `magpie` CLI wrapper; Gherkin importer; filtering; console/JSON/HTML reporting with acceptance traceability.
