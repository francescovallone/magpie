import type { Scenario } from "./domain.js";

export interface ScenarioFilter {
  readonly tags?: ReadonlyArray<string>;
  readonly acceptance?: ReadonlyArray<string>;
  readonly story?: string | RegExp;
  readonly scenario?: string | RegExp;
  readonly regex?: string | RegExp;
}

function toRegExp(value: string | RegExp): RegExp {
  if (value instanceof RegExp) {
    return value;
  }

  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesPattern(value: string, matcher: string | RegExp): boolean {
  return toRegExp(matcher).test(value);
}

export function createScenarioFilter<TContext extends object>(filter: ScenarioFilter) {
  return (candidate: Scenario<TContext>): boolean => {
    if (filter.tags?.length && !filter.tags.some((tag) => candidate.tags.includes(tag))) {
      return false;
    }

    if (
      filter.acceptance?.length &&
      !filter.acceptance.some((matcher) =>
        candidate.acceptance.some((reference) => matchesPattern(reference, matcher)),
      )
    ) {
      return false;
    }

    if (filter.story) {
      const storyTitle = candidate.story?.title ?? "";
      if (!matchesPattern(storyTitle, filter.story)) {
        return false;
      }
    }

    if (filter.scenario && !matchesPattern(candidate.title, filter.scenario)) {
      return false;
    }

    if (filter.regex) {
      const matcher = toRegExp(filter.regex);
      const haystack = [
        candidate.id,
        candidate.title,
        candidate.description ?? "",
        ...(candidate.acceptance ?? []),
        ...(candidate.tags ?? []),
        candidate.story?.title ?? "",
      ].join(" ");

      if (!matcher.test(haystack)) {
        return false;
      }
    }

    return true;
  };
}

export function filterScenarios<TContext extends object>(
  scenarios: ReadonlyArray<Scenario<TContext>>,
  filter: ScenarioFilter,
): ReadonlyArray<Scenario<TContext>> {
  return scenarios.filter(createScenarioFilter(filter));
}