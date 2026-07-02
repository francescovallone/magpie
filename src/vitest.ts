import { describe, it } from "vitest";

import type { Scenario, Story } from "./domain.js";
import { filterScenarios, type ScenarioFilter } from "./filtering.js";
import type { AcceptanceReporter } from "./reporting.js";
import { appendVitestReporterRecord, type VitestAdapterBridgeOptions } from "./vitest-bridge.js";
import {
  executeScenario,
  type ExecuteScenarioOptions,
  type ScenarioExecutionResult,
} from "./engine.js";

export interface VitestApi {
  describe(name: string, run: () => void): void;
  it(name: string, run: () => Promise<void> | void): void;
}

export interface VitestScenarioAdapterOptions<TContext extends object>
  extends ExecuteScenarioOptions<TContext> {
  readonly api?: VitestApi;
  readonly filter?: ScenarioFilter;
  readonly reporter?: AcceptanceReporter<TContext>;
  readonly reportToVitest?: boolean | VitestAdapterBridgeOptions;
  readonly executor?: (
    scenario: Scenario<TContext>,
    options?: ExecuteScenarioOptions<TContext>,
  ) => Promise<ScenarioExecutionResult<TContext>>;
}

function resolveBridgeOptions(
  value: boolean | VitestAdapterBridgeOptions | undefined,
): VitestAdapterBridgeOptions | undefined {
  if (!value) {
    return undefined;
  }

  return typeof value === "boolean" ? { enabled: value } : { enabled: true, ...value };
}

async function recordVitestScenario<TContext extends object>(
  scenario: Scenario<TContext>,
  result: ScenarioExecutionResult<TContext>,
  options: VitestScenarioAdapterOptions<TContext>,
): Promise<void> {
  await options.reporter?.recordScenario(scenario, result);

  const bridgeOptions = resolveBridgeOptions(options.reportToVitest);

  if (bridgeOptions?.enabled) {
    await appendVitestReporterRecord(scenario, result, bridgeOptions);
  }
}

function throwVitestFailure<TContext extends object>(
  result: ScenarioExecutionResult<TContext>,
): never {
  if (result.failure?.cause instanceof Error) {
    throw result.failure.cause;
  }

  throw new Error(result.failure?.error.message ?? `Scenario failed: ${result.scenarioTitle}`);
}

export function registerScenario<TContext extends object>(
  scenario: Scenario<TContext>,
  options: VitestScenarioAdapterOptions<TContext> = {},
): void {
  const api = options.api ?? { describe, it };
  const executor = options.executor ?? executeScenario;

  api.describe(scenario.story?.title ?? scenario.title, () => {
    api.it(scenario.title, async () => {
      const result = await executor(scenario, options);
      await recordVitestScenario(scenario, result, options);

      if (!result.success) {
        throwVitestFailure(result);
      }
    });
  });
}

export function registerStory<TContext extends object>(
  story: Story<TContext>,
  options: VitestScenarioAdapterOptions<TContext> = {},
): void {
  const api = options.api ?? { describe, it };

  api.describe(story.title, () => {
    for (const scenario of story.scenarios) {
      api.it(scenario.title, async () => {
        const result = await (options.executor ?? executeScenario)(scenario, options);
        await recordVitestScenario(scenario, result, options);

        if (!result.success) {
          throwVitestFailure(result);
        }
      });
    }
  });
}

export function registerFilteredStory<TContext extends object>(
  story: Story<TContext>,
  options: VitestScenarioAdapterOptions<TContext> = {},
): void {
  const api = options.api ?? { describe, it };
  const scenarios = options.filter ? filterScenarios(story.scenarios, options.filter) : story.scenarios;

  api.describe(story.title, () => {
    for (const scenario of scenarios) {
      api.it(scenario.title, async () => {
        const result = await (options.executor ?? executeScenario)(scenario, options);
        await recordVitestScenario(scenario, result, options);

        if (!result.success) {
          throwVitestFailure(result);
        }
      });
    }
  });
}