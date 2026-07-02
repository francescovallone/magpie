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