import { filterScenarios, type ScenarioFilter } from "./filtering.js";
import type { Scenario } from "./domain.js";

export interface ScenarioFilterResolutionOptions {
  readonly argv?: ReadonlyArray<string>;
  readonly env?: Record<string, string | undefined>;
  readonly envPrefix?: string;
}

function splitCsv(value?: string): Array<string> {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function pushArgValue(target: Array<string>, rawValue?: string): void {
  if (!rawValue) {
    return;
  }

  target.push(...splitCsv(rawValue));
}

function normalizeSingle(values: Array<string>): string | undefined {
  return values.at(-1);
}

function normalizeMulti(values: Array<string>): ReadonlyArray<string> | undefined {
  return values.length ? values : undefined;
}

export function resolveScenarioFilter(
  options: ScenarioFilterResolutionOptions = {},
): ScenarioFilter {
  const argv = options.argv ?? [];
  const env = options.env ?? {};
  const prefix = options.envPrefix ?? "MAGPIE";
  const tags = splitCsv(env[`${prefix}_TAGS`]);
  const acceptance = splitCsv(env[`${prefix}_ACCEPTANCE`]);
  const story: Array<string> = env[`${prefix}_STORY`] ? [env[`${prefix}_STORY`]!] : [];
  const scenario: Array<string> = env[`${prefix}_SCENARIO`] ? [env[`${prefix}_SCENARIO`]!] : [];
  const regex: Array<string> = env[`${prefix}_REGEX`] ? [env[`${prefix}_REGEX`]!] : [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = argv[index + 1];

    if (argument === undefined) {
      continue;
    }

    if (argument === "--tag") {
      pushArgValue(tags, nextValue);
      index += 1;
      continue;
    }

    if (argument.startsWith("--tag=")) {
      pushArgValue(tags, argument.slice("--tag=".length));
      continue;
    }

    if (argument === "--acceptance") {
      pushArgValue(acceptance, nextValue);
      index += 1;
      continue;
    }

    if (argument.startsWith("--acceptance=")) {
      pushArgValue(acceptance, argument.slice("--acceptance=".length));
      continue;
    }

    if (argument === "--story") {
      pushArgValue(story, nextValue);
      index += 1;
      continue;
    }

    if (argument.startsWith("--story=")) {
      pushArgValue(story, argument.slice("--story=".length));
      continue;
    }

    if (argument === "--scenario") {
      pushArgValue(scenario, nextValue);
      index += 1;
      continue;
    }

    if (argument.startsWith("--scenario=")) {
      pushArgValue(scenario, argument.slice("--scenario=".length));
      continue;
    }

    if (argument === "--regex" || argument === "--grep") {
      pushArgValue(regex, nextValue);
      index += 1;
      continue;
    }

    if (argument.startsWith("--regex=")) {
      pushArgValue(regex, argument.slice("--regex=".length));
      continue;
    }

    if (argument.startsWith("--grep=")) {
      pushArgValue(regex, argument.slice("--grep=".length));
    }
  }

  const filter: ScenarioFilter = {};

  const normalizedTags = normalizeMulti(tags);
  const normalizedAcceptance = normalizeMulti(acceptance);
  const normalizedStory = normalizeSingle(story);
  const normalizedScenario = normalizeSingle(scenario);
  const normalizedRegex = normalizeSingle(regex);

  if (normalizedTags) {
    Object.assign(filter, { tags: normalizedTags });
  }

  if (normalizedAcceptance) {
    Object.assign(filter, { acceptance: normalizedAcceptance });
  }

  if (normalizedStory) {
    Object.assign(filter, { story: normalizedStory });
  }

  if (normalizedScenario) {
    Object.assign(filter, { scenario: normalizedScenario });
  }

  if (normalizedRegex) {
    Object.assign(filter, { regex: normalizedRegex });
  }

  return filter;
}

export function selectScenarios<TContext extends object>(
  scenarios: ReadonlyArray<Scenario<TContext>>,
  options: ScenarioFilterResolutionOptions = {},
): ReadonlyArray<Scenario<TContext>> {
  return filterScenarios(scenarios, resolveScenarioFilter(options));
}

export interface OutputResolutionOptions {
  readonly argv?: ReadonlyArray<string>;
  readonly env?: Record<string, string | undefined>;
  readonly envPrefix?: string;
}

/**
 * Parses which report output formats (e.g. "html", "json") were requested
 * through `--output <kind>` / `--output=<kind>` CLI flags or the
 * `MAGPIE_OUTPUT` environment variable. Named `--output` (not `--reporter`)
 * so it never collides with Vitest's own built-in `--reporter` CLI flag.
 */
export function resolveOutputKinds(
  options: OutputResolutionOptions = {},
): ReadonlySet<string> {
  const argv = options.argv ?? [];
  const env = options.env ?? {};
  const prefix = options.envPrefix ?? "MAGPIE";
  const kinds: Array<string> = splitCsv(env[`${prefix}_OUTPUT`]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = argv[index + 1];

    if (argument === undefined) {
      continue;
    }

    if (argument === "--output") {
      pushArgValue(kinds, nextValue);
      index += 1;
      continue;
    }

    if (argument.startsWith("--output=")) {
      pushArgValue(kinds, argument.slice("--output=".length));
    }
  }

  return new Set(kinds.map((kind) => kind.toLowerCase()));
}

export function isOutputEnabled(
  kind: string,
  options: OutputResolutionOptions = {},
): boolean {
  return resolveOutputKinds(options).has(kind.toLowerCase());
}

/** CLI flags owned by Magpie; every one of them takes a value. */
export const MAGPIE_FLAG_NAMES: ReadonlyArray<string> = Object.freeze([
  "--tag",
  "--acceptance",
  "--story",
  "--scenario",
  "--regex",
  "--grep",
  "--output",
]);

export interface MagpieArgvPartition {
  /** The Magpie-owned flags (with their values), in original order. */
  readonly magpieArgv: ReadonlyArray<string>;
  /** Everything else, to be forwarded to the underlying runner. */
  readonly forwardedArgv: ReadonlyArray<string>;
}

/**
 * Splits an argv array into Magpie-owned flags and arguments meant for the
 * underlying runner (Vitest). Used by the `magpie` CLI wrapper so filter
 * flags can be typed directly — `magpie run --tag auth` — without the
 * `-- --tag auth` passthrough dance that Vitest's own CLI requires.
 */
export function partitionMagpieArgv(argv: ReadonlyArray<string>): MagpieArgvPartition {
  const magpieArgv: Array<string> = [];
  const forwardedArgv: Array<string> = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === undefined) {
      continue;
    }

    if (MAGPIE_FLAG_NAMES.includes(argument)) {
      magpieArgv.push(argument);
      const value = argv[index + 1];

      if (value !== undefined) {
        magpieArgv.push(value);
        index += 1;
      }

      continue;
    }

    if (MAGPIE_FLAG_NAMES.some((flag) => argument.startsWith(`${flag}=`))) {
      magpieArgv.push(argument);
      continue;
    }

    forwardedArgv.push(argument);
  }

  return { magpieArgv, forwardedArgv };
}

/**
 * Converts Magpie CLI flags into their equivalent `MAGPIE_*` environment
 * variables. Environment variables are the transport that reliably reaches
 * Vitest's worker processes, so the CLI wrapper sets these instead of
 * forwarding the flags.
 */
export function toMagpieEnv(
  argv: ReadonlyArray<string>,
  envPrefix = "MAGPIE",
): Record<string, string> {
  const filter = resolveScenarioFilter({ argv });
  const outputKinds = resolveOutputKinds({ argv });
  const env: Record<string, string> = {};

  if (filter.tags?.length) {
    env[`${envPrefix}_TAGS`] = filter.tags.join(",");
  }

  if (filter.acceptance?.length) {
    env[`${envPrefix}_ACCEPTANCE`] = filter.acceptance.join(",");
  }

  if (filter.story !== undefined) {
    env[`${envPrefix}_STORY`] = String(filter.story);
  }

  if (filter.scenario !== undefined) {
    env[`${envPrefix}_SCENARIO`] = String(filter.scenario);
  }

  if (filter.regex !== undefined) {
    env[`${envPrefix}_REGEX`] = String(filter.regex);
  }

  if (outputKinds.size > 0) {
    env[`${envPrefix}_OUTPUT`] = Array.from(outputKinds).join(",");
  }

  return env;
}