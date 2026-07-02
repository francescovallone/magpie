import type {
  Scenario,
  ScenarioStep,
  StepExecutionApi,
} from "./domain.js";

export interface ExecutionLogEntry {
  readonly timestamp: number;
  readonly message: string;
  readonly data?: unknown;
  readonly stepId?: string;
}

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export interface StepExecutionResult {
  readonly stepId: string;
  readonly stepName: string;
  readonly type: string;
  readonly lifecycle: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly duration: number;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly logs: ReadonlyArray<ExecutionLogEntry>;
  readonly error?: SerializedError;
}

export interface ScenarioFailure<TContext extends object> {
  readonly step: ScenarioStep<TContext>;
  readonly error: SerializedError;
  readonly cause: unknown;
}

export interface ScenarioExecutionResult<TContext extends object> {
  readonly scenarioId: string;
  readonly scenarioTitle: string;
  readonly acceptance: ReadonlyArray<string>;
  readonly success: boolean;
  readonly duration: number;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly context: TContext;
  readonly logs: ReadonlyArray<ExecutionLogEntry>;
  readonly steps: ReadonlyArray<StepExecutionResult>;
  readonly failure?: ScenarioFailure<TContext>;
}

export interface ExecutionHooks<TContext extends object> {
  readonly beforeScenario?: (scenario: Scenario<TContext>, context: TContext) => Promise<void> | void;
  readonly afterScenario?: (
    scenario: Scenario<TContext>,
    context: TContext,
    result: ScenarioExecutionResult<TContext>,
  ) => Promise<void> | void;
  readonly beforeStep?: (step: ScenarioStep<TContext>, context: TContext) => Promise<void> | void;
  readonly afterStep?: (
    step: ScenarioStep<TContext>,
    context: TContext,
    result: StepExecutionResult,
  ) => Promise<void> | void;
}

export interface ExecuteScenarioOptions<TContext extends object> {
  readonly context?: TContext;
  readonly createContext?: () => TContext;
  readonly hooks?: ExecutionHooks<TContext>;
  readonly now?: () => number;
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const serialized: SerializedError = {
      name: error.name,
      message: error.message,
    };

    if (error.stack !== undefined) {
      Object.assign(serialized, { stack: error.stack });
    }

    return serialized;
  }

  return {
    name: "Error",
    message: typeof error === "string" ? error : JSON.stringify(error),
  };
}

function createContext<TContext extends object>(options: ExecuteScenarioOptions<TContext>): TContext {
  if (options.context) {
    return options.context;
  }

  if (options.createContext) {
    return options.createContext();
  }

  return {} as TContext;
}

interface ExecutedStep {
  readonly result: StepExecutionResult;
  readonly cause?: unknown;
}

function partitionSteps<TContext extends object>(scenario: Scenario<TContext>) {
  const mainSteps: Array<ScenarioStep<TContext>> = [];
  const cleanupSteps: Array<ScenarioStep<TContext>> = [];

  for (const step of scenario.steps) {
    if (step.lifecycle === "cleanup") {
      cleanupSteps.push(step);
      continue;
    }

    mainSteps.push(step);
  }

  return { mainSteps, cleanupSteps };
}

export async function executeScenario<TContext extends object>(
  scenario: Scenario<TContext>,
  options: ExecuteScenarioOptions<TContext> = {},
): Promise<ScenarioExecutionResult<TContext>> {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const logs: Array<ExecutionLogEntry> = [];
  const stepResults: Array<StepExecutionResult> = [];
  const context = createContext(options);
  const { mainSteps, cleanupSteps } = partitionSteps(scenario);
  let failure: ScenarioFailure<TContext> | undefined;

  const createLogger = (stepId?: string) => (message: string, data?: unknown) => {
    const entry: ExecutionLogEntry = { timestamp: now(), message };

    if (data !== undefined) {
      Object.assign(entry, { data });
    }

    if (stepId !== undefined) {
      Object.assign(entry, { stepId });
    }

    logs.push(entry);
  };

  const runStep = async (
    step: ScenarioStep<TContext>,
    allowFailureToBubble = false,
  ): Promise<ExecutedStep> => {
    const stepStartedAt = now();
    const stepLogs: Array<ExecutionLogEntry> = [];
    const stepLogger = (message: string, data?: unknown) => {
      const entry: ExecutionLogEntry = { timestamp: now(), message, stepId: step.id };

      if (data !== undefined) {
        Object.assign(entry, { data });
      }

      logs.push(entry);
      stepLogs.push(entry);
    };

    try {
      await options.hooks?.beforeStep?.(step, context);

      const api: StepExecutionApi<TContext> = {
        context,
        log: stepLogger,
      };

      await step.execute(context, api);

      const passedResult: StepExecutionResult = {
        stepId: step.id,
        stepName: step.name,
        type: step.type,
        lifecycle: step.lifecycle,
        status: "passed",
        duration: now() - stepStartedAt,
        startedAt: stepStartedAt,
        finishedAt: now(),
        logs: stepLogs,
      };

      await options.hooks?.afterStep?.(step, context, passedResult);

      return { result: passedResult };
    } catch (error) {
      const failedResult: StepExecutionResult = {
        stepId: step.id,
        stepName: step.name,
        type: step.type,
        lifecycle: step.lifecycle,
        status: "failed",
        duration: now() - stepStartedAt,
        startedAt: stepStartedAt,
        finishedAt: now(),
        logs: stepLogs,
        error: serializeError(error),
      };

      try {
        await options.hooks?.afterStep?.(step, context, failedResult);
      } catch (hookError) {
        if (!allowFailureToBubble) {
          throw hookError;
        }
      }

      if (allowFailureToBubble) {
        throw error;
      }

      return { result: failedResult, cause: error };
    }
  };

  await options.hooks?.beforeScenario?.(scenario, context);
  createLogger()("scenario.started", { scenarioId: scenario.id });

  for (const step of mainSteps) {
    const executed = await runStep(step);
    stepResults.push(executed.result);

    if (executed.result.status === "failed") {
      failure = {
        step,
        error: executed.result.error!,
        cause: executed.cause,
      };
      break;
    }
  }

  for (const cleanupStep of cleanupSteps) {
    try {
      const executed = await runStep(cleanupStep, true);
      stepResults.push(executed.result);
    } catch (error) {
      const cleanupResult: StepExecutionResult = {
        stepId: cleanupStep.id,
        stepName: cleanupStep.name,
        type: cleanupStep.type,
        lifecycle: cleanupStep.lifecycle,
        status: "failed",
        duration: 0,
        startedAt: now(),
        finishedAt: now(),
        logs: [],
        error: serializeError(error),
      };

      stepResults.push(cleanupResult);

      if (!failure) {
        failure = {
          step: cleanupStep,
          error: cleanupResult.error!,
          cause: error,
        };
      }
    }
  }

  createLogger()("scenario.finished", {
    scenarioId: scenario.id,
    success: !failure,
  });

  const resultBase = {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    acceptance: scenario.acceptance,
    success: !failure,
    duration: now() - startedAt,
    startedAt,
    finishedAt: now(),
    context,
    logs,
    steps: stepResults,
  };
  const result: ScenarioExecutionResult<TContext> = failure
    ? { ...resultBase, failure }
    : resultBase;

  await options.hooks?.afterScenario?.(scenario, context, result);

  return result;
}