# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
