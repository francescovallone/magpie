import { extname } from "node:path";
import type { Scenario, ScenarioStep, StepExecutionApi, SubScenario } from "./domain.js";

export interface ExecutionLogEntry {
  readonly timestamp: number;
  readonly message: string;
  readonly data?: unknown;
  readonly stepId?: string;
}

export interface ExecutionAttachment {
  readonly timestamp: number;
  readonly name: string;
  readonly contentType: string;
  readonly stepId?: string;
  readonly body?: string | Uint8Array;
  readonly path?: string;
}

const ATTACHMENT_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webm": "video/webm",
  ".zip": "application/zip",
  ".json": "application/json",
  ".txt": "text/plain",
};

function inferAttachmentContentType(name: string): string {
  return ATTACHMENT_CONTENT_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";
}

/** Thrown from a step to mark the scenario as skipped instead of failed. */
export class ScenarioSkip extends Error {
  constructor(message?: string) {
    super(message ?? "Scenario skipped");
    this.name = "ScenarioSkip";
  }
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
  readonly attachments: ReadonlyArray<ExecutionAttachment>;
  readonly error?: SerializedError;
}

export interface ScenarioFailure<TContext extends object> {
  readonly step: ScenarioStep<TContext>;
  readonly error: SerializedError;
  readonly cause: unknown;
}

export interface SubScenarioExecutionResult<TContext extends object> {
  readonly subScenarioId: string;
  readonly acceptance: ReadonlyArray<string>;
  readonly success: boolean;
  readonly duration: number;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly context: TContext;
  readonly logs: ReadonlyArray<ExecutionLogEntry>;
  readonly attachments: ReadonlyArray<ExecutionAttachment>;
  readonly steps: ReadonlyArray<StepExecutionResult>;
  readonly failure?: ScenarioFailure<TContext>;
  /** Present when the sub-scenario was retried; total number of attempts executed. */
  readonly attempts?: number;
  /** Present when a step threw `ScenarioSkip`; the sub-scenario is reported as skipped instead of passed/failed. */
  readonly skipped?: boolean;
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
  readonly attachments: ReadonlyArray<ExecutionAttachment>;
  readonly steps: ReadonlyArray<StepExecutionResult>;
  readonly failure?: ScenarioFailure<TContext>;
  /**
   * Present when the scenario was retried (via `Scenario.retries` or
   * `ExecuteScenarioOptions.retries`); total number of attempts executed.
   * The result reflects the last attempt.
   */
  readonly attempts?: number;
  /**
   * Present when the scenario has more than one "given" step. Each entry is
   * the independent result of executing one sub-scenario. If any
   * sub-scenario fails, the parent scenario's `success` is `false` too.
   */
  readonly subScenarios?: ReadonlyArray<SubScenarioExecutionResult<TContext>>;
  /** Present when a step threw `ScenarioSkip`; the scenario is reported as skipped instead of passed/failed. */
  readonly skipped?: boolean;
}

export interface SkippedScenarioExecutionResult {
  readonly scenarioId: string;
  readonly scenarioTitle: string;
  readonly dependsOn: ReadonlyArray<string>;
  readonly reason: "dependency_failed";
}

export interface ScenarioBatchExecutionResult<TContext extends object> {
  readonly results: ReadonlyArray<ScenarioExecutionResult<TContext>>;
  readonly skipped: ReadonlyArray<SkippedScenarioExecutionResult>;
}

export interface ExecutionHooks<TContext extends object> {
  readonly beforeScenario?: (
    scenario: Scenario<TContext>,
    context: TContext,
  ) => Promise<void> | void;
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
  /**
   * Default number of retries for scenarios that do not declare their own
   * `retries`. A scenario-level `retries` always takes precedence.
   */
  readonly retries?: number;
}

export interface ExecuteScenariosOptions<
  TContext extends object,
> extends ExecuteScenarioOptions<TContext> {
  readonly maxConcurrency?: number;
}

export function mergeExecutionHooks<TContext extends object>(
  ...hookSets: ReadonlyArray<ExecutionHooks<TContext> | undefined>
): ExecutionHooks<TContext> {
  const definedHookSets = hookSets.filter(
    (hookSet): hookSet is ExecutionHooks<TContext> => hookSet !== undefined,
  );

  if (definedHookSets.length === 0) {
    return {};
  }

  const merged: ExecutionHooks<TContext> = {};

  const beforeScenarioHooks = definedHookSets
    .map((hookSet) => hookSet.beforeScenario)
    .filter(
      (hook): hook is NonNullable<ExecutionHooks<TContext>["beforeScenario"]> => hook !== undefined,
    );
  if (beforeScenarioHooks.length) {
    Object.assign(merged, {
      async beforeScenario(scenario: Scenario<TContext>, context: TContext) {
        for (const hook of beforeScenarioHooks) {
          await hook(scenario, context);
        }
      },
    });
  }

  const afterScenarioHooks = definedHookSets
    .map((hookSet) => hookSet.afterScenario)
    .filter(
      (hook): hook is NonNullable<ExecutionHooks<TContext>["afterScenario"]> => hook !== undefined,
    );
  if (afterScenarioHooks.length) {
    Object.assign(merged, {
      async afterScenario(
        scenario: Scenario<TContext>,
        context: TContext,
        result: ScenarioExecutionResult<TContext>,
      ) {
        for (const hook of afterScenarioHooks) {
          await hook(scenario, context, result);
        }
      },
    });
  }

  const beforeStepHooks = definedHookSets
    .map((hookSet) => hookSet.beforeStep)
    .filter(
      (hook): hook is NonNullable<ExecutionHooks<TContext>["beforeStep"]> => hook !== undefined,
    );
  if (beforeStepHooks.length) {
    Object.assign(merged, {
      async beforeStep(step: ScenarioStep<TContext>, context: TContext) {
        for (const hook of beforeStepHooks) {
          await hook(step, context);
        }
      },
    });
  }

  const afterStepHooks = definedHookSets
    .map((hookSet) => hookSet.afterStep)
    .filter(
      (hook): hook is NonNullable<ExecutionHooks<TContext>["afterStep"]> => hook !== undefined,
    );
  if (afterStepHooks.length) {
    Object.assign(merged, {
      async afterStep(
        step: ScenarioStep<TContext>,
        context: TContext,
        result: StepExecutionResult,
      ) {
        for (const hook of afterStepHooks) {
          await hook(step, context, result);
        }
      },
    });
  }

  return merged;
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

function createContext<TContext extends object>(
  options: ExecuteScenarioOptions<TContext>,
): TContext {
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

interface ScenarioExecutionNode<TContext extends object> {
  readonly scenario: Scenario<TContext>;
  readonly dependencies: ReadonlyArray<string>;
  readonly dependents: Array<string>;
  pendingDependencies: number;
  readonly failedDependencies: Set<string>;
}

function resolveMaxConcurrency(count: number, requested: number | undefined): number {
  if (requested === undefined) {
    return Math.max(1, count);
  }

  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error("maxConcurrency must be an integer greater than 0");
  }

  return requested;
}

function createScenarioExecutionNodes<TContext extends object>(
  scenarios: ReadonlyArray<Scenario<TContext>>,
): Map<string, ScenarioExecutionNode<TContext>> {
  const nodes = new Map<string, ScenarioExecutionNode<TContext>>();

  for (const scenario of scenarios) {
    if (nodes.has(scenario.id)) {
      throw new Error(`Duplicate scenario id: ${scenario.id}`);
    }

    const dependencies = scenario.dependsOn ?? [];

    if (dependencies.includes(scenario.id)) {
      throw new Error(`Scenario cannot depend on itself: ${scenario.id}`);
    }

    nodes.set(scenario.id, {
      scenario,
      dependencies,
      dependents: [],
      pendingDependencies: dependencies.length,
      failedDependencies: new Set<string>(),
    });
  }

  for (const node of nodes.values()) {
    for (const dependencyId of node.dependencies) {
      const dependencyNode = nodes.get(dependencyId);

      if (!dependencyNode) {
        throw new Error(`Scenario ${node.scenario.id} depends on missing scenario ${dependencyId}`);
      }

      dependencyNode.dependents.push(node.scenario.id);
    }
  }

  const remainingDependencies = new Map(
    Array.from(nodes.values(), (node) => [node.scenario.id, node.dependencies.length]),
  );
  const queue = Array.from(nodes.values())
    .filter((node) => node.dependencies.length === 0)
    .map((node) => node.scenario.id);
  let visitedCount = 0;

  while (queue.length > 0) {
    const scenarioId = queue.shift();

    if (!scenarioId) {
      break;
    }

    visitedCount += 1;
    const node = nodes.get(scenarioId);

    if (!node) {
      continue;
    }

    for (const dependentId of node.dependents) {
      const nextCount = (remainingDependencies.get(dependentId) ?? 0) - 1;
      remainingDependencies.set(dependentId, nextCount);

      if (nextCount === 0) {
        queue.push(dependentId);
      }
    }
  }

  if (visitedCount !== scenarios.length) {
    throw new Error("Cyclic scenario dependency detected");
  }

  return nodes;
}

export async function executeScenarios<TContext extends object>(
  scenarios: ReadonlyArray<Scenario<TContext>>,
  options: ExecuteScenariosOptions<TContext> = {},
): Promise<ScenarioBatchExecutionResult<TContext>> {
  const maxConcurrency = resolveMaxConcurrency(scenarios.length, options.maxConcurrency);

  if (options.context !== undefined && maxConcurrency > 1) {
    throw new Error(
      "executeScenarios does not support shared context when maxConcurrency is greater than 1",
    );
  }

  if (scenarios.length === 0) {
    return {
      results: Object.freeze([]),
      skipped: Object.freeze([]),
    };
  }

  const nodes = createScenarioExecutionNodes(scenarios);
  const readyQueue = scenarios
    .filter((scenario) => (scenario.dependsOn?.length ?? 0) === 0)
    .map((scenario) => scenario.id);
  const resultsById = new Map<string, ScenarioExecutionResult<TContext>>();
  const skippedById = new Map<string, SkippedScenarioExecutionResult>();

  const markResolved = (scenarioId: string, success: boolean) => {
    const node = nodes.get(scenarioId);

    if (!node) {
      return;
    }

    for (const dependentId of node.dependents) {
      const dependent = nodes.get(dependentId);

      if (!dependent) {
        continue;
      }

      dependent.pendingDependencies -= 1;

      if (!success) {
        dependent.failedDependencies.add(scenarioId);
      }

      if (dependent.pendingDependencies === 0) {
        if (dependent.failedDependencies.size > 0) {
          skippedById.set(dependent.scenario.id, {
            scenarioId: dependent.scenario.id,
            scenarioTitle: dependent.scenario.title,
            dependsOn: Object.freeze(Array.from(dependent.failedDependencies)),
            reason: "dependency_failed",
          });
          markResolved(dependent.scenario.id, false);
          continue;
        }

        readyQueue.push(dependent.scenario.id);
      }
    }
  };

  await new Promise<void>((resolve, reject) => {
    let activeExecutions = 0;

    const maybeFinish = () => {
      if (resultsById.size + skippedById.size === scenarios.length && activeExecutions === 0) {
        resolve();
      }
    };

    const schedule = () => {
      while (activeExecutions < maxConcurrency && readyQueue.length > 0) {
        const scenarioId = readyQueue.shift();

        if (!scenarioId) {
          continue;
        }

        if (resultsById.has(scenarioId) || skippedById.has(scenarioId)) {
          continue;
        }

        const node = nodes.get(scenarioId);

        if (!node) {
          continue;
        }

        activeExecutions += 1;

        void executeScenario(node.scenario, options)
          .then((result) => {
            resultsById.set(node.scenario.id, result);
            markResolved(node.scenario.id, result.success);
          })
          .then(() => {
            activeExecutions -= 1;
            schedule();
            maybeFinish();
          })
          .catch((error) => {
            reject(error);
          });
      }

      maybeFinish();
    };

    schedule();
  });

  return {
    results: Object.freeze(
      scenarios.flatMap((scenario) => {
        const result = resultsById.get(scenario.id);
        return result ? [result] : [];
      }),
    ),
    skipped: Object.freeze(
      scenarios.flatMap((scenario) => {
        const skipped = skippedById.get(scenario.id);
        return skipped ? [skipped] : [];
      }),
    ),
  };
}

function createSyntheticSubScenario<TContext extends object>(
  scenario: Scenario<TContext>,
  subScenario: SubScenario<TContext>,
  cleanupSteps: ReadonlyArray<ScenarioStep<TContext>>,
): Scenario<TContext> {
  const synthetic: Scenario<TContext> = {
    id: subScenario.id,
    title: `${scenario.title} \u2013 ${subScenario.id}`,
    acceptance: subScenario.acceptance,
    tags: scenario.tags,
    metadata: scenario.metadata,
    steps: Object.freeze([...subScenario.steps, ...cleanupSteps]),
  };

  if (scenario.description !== undefined) {
    Object.assign(synthetic, { description: scenario.description });
  }

  if (scenario.story !== undefined) {
    Object.assign(synthetic, { story: scenario.story });
  }

  if (scenario.retries !== undefined) {
    Object.assign(synthetic, { retries: scenario.retries });
  }

  return synthetic;
}

async function executeScenarioWithSubScenarios<TContext extends object>(
  scenario: Scenario<TContext>,
  subScenarios: ReadonlyArray<SubScenario<TContext>>,
  options: ExecuteScenarioOptions<TContext>,
): Promise<ScenarioExecutionResult<TContext>> {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const { cleanupSteps } = partitionSteps(scenario);

  const subResults: Array<SubScenarioExecutionResult<TContext>> = [];
  const aggregatedLogs: Array<ExecutionLogEntry> = [];
  const aggregatedAttachments: Array<ExecutionAttachment> = [];
  const aggregatedSteps: Array<StepExecutionResult> = [];
  let failure: ScenarioFailure<TContext> | undefined;
  let lastContext: TContext | undefined;

  for (const subScenario of subScenarios) {
    const syntheticScenario = createSyntheticSubScenario(scenario, subScenario, cleanupSteps);
    const subResult = await executeScenario(syntheticScenario, options);

    lastContext = subResult.context;
    aggregatedLogs.push(...subResult.logs);
    aggregatedAttachments.push(...subResult.attachments);
    aggregatedSteps.push(...subResult.steps);

    if (!failure && subResult.failure) {
      failure = subResult.failure;
    }

    subResults.push({
      subScenarioId: subScenario.id,
      acceptance: subScenario.acceptance,
      success: subResult.success,
      duration: subResult.duration,
      startedAt: subResult.startedAt,
      finishedAt: subResult.finishedAt,
      context: subResult.context,
      logs: subResult.logs,
      attachments: subResult.attachments,
      steps: subResult.steps,
      ...(subResult.failure ? { failure: subResult.failure } : {}),
      ...(subResult.attempts !== undefined ? { attempts: subResult.attempts } : {}),
      ...(subResult.skipped ? { skipped: true } : {}),
    });
  }

  const finishedAt = now();
  const resultBase = {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    acceptance: scenario.acceptance,
    success: subResults.every((subResult) => subResult.success),
    ...(subResults.length > 0 &&
    subResults.every((subResult) => subResult.success) &&
    subResults.some((subResult) => subResult.skipped)
      ? { skipped: true }
      : {}),
    duration: finishedAt - startedAt,
    startedAt,
    finishedAt,
    context: lastContext ?? createContext(options),
    logs: Object.freeze(aggregatedLogs),
    attachments: Object.freeze(aggregatedAttachments),
    steps: Object.freeze(aggregatedSteps),
    subScenarios: Object.freeze(subResults),
  };

  return failure ? { ...resultBase, failure } : resultBase;
}

function resolveRetries<TContext extends object>(
  scenario: Scenario<TContext>,
  options: ExecuteScenarioOptions<TContext>,
): number {
  const retries = scenario.retries ?? options.retries ?? 0;

  if (!Number.isInteger(retries) || retries < 0) {
    throw new Error("retries must be a non-negative integer");
  }

  return retries;
}

export async function executeScenario<TContext extends object>(
  scenario: Scenario<TContext>,
  options: ExecuteScenarioOptions<TContext> = {},
): Promise<ScenarioExecutionResult<TContext>> {
  if (scenario.subScenarios && scenario.subScenarios.length > 0) {
    return executeScenarioWithSubScenarios(scenario, scenario.subScenarios, options);
  }

  const maxAttempts = resolveRetries(scenario, options) + 1;
  let result: ScenarioExecutionResult<TContext>;
  let attempt = 0;

  do {
    attempt += 1;
    result = await executeScenarioAttempt(scenario, options);
  } while (!result.success && attempt < maxAttempts);

  if (attempt > 1) {
    result = { ...result, attempts: attempt };
  }

  await options.hooks?.afterScenario?.(scenario, result.context, result);

  return result;
}

async function executeScenarioAttempt<TContext extends object>(
  scenario: Scenario<TContext>,
  options: ExecuteScenarioOptions<TContext>,
): Promise<ScenarioExecutionResult<TContext>> {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const logs: Array<ExecutionLogEntry> = [];
  const attachments: Array<ExecutionAttachment> = [];
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
    const stepAttachments: Array<ExecutionAttachment> = [];
    const stepLogger = (message: string, data?: unknown) => {
      const entry: ExecutionLogEntry = { timestamp: now(), message, stepId: step.id };

      if (data !== undefined) {
        Object.assign(entry, { data });
      }

      logs.push(entry);
      stepLogs.push(entry);
    };
    const attach = (
      name: string,
      body: string | Uint8Array | { readonly path: string },
      contentType?: string,
    ) => {
      const entry: ExecutionAttachment = {
        timestamp: now(),
        name,
        contentType: contentType ?? inferAttachmentContentType(name),
        stepId: step.id,
        ...(typeof body === "object" && !(body instanceof Uint8Array)
          ? { path: body.path }
          : { body }),
      };

      attachments.push(entry);
      stepAttachments.push(entry);
    };

    try {
      await options.hooks?.beforeStep?.(step, context);

      const api: StepExecutionApi<TContext> = {
        context,
        log: stepLogger,
        attach,
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
        attachments: stepAttachments,
      };

      await options.hooks?.afterStep?.(step, context, passedResult);

      return { result: passedResult };
    } catch (error) {
      if (error instanceof ScenarioSkip) {
        const skippedResult: StepExecutionResult = {
          stepId: step.id,
          stepName: step.name,
          type: step.type,
          lifecycle: step.lifecycle,
          status: "skipped",
          duration: now() - stepStartedAt,
          startedAt: stepStartedAt,
          finishedAt: now(),
          logs: stepLogs,
          attachments: stepAttachments,
        };

        await options.hooks?.afterStep?.(step, context, skippedResult);

        return { result: skippedResult, cause: error };
      }

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
        attachments: stepAttachments,
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

  let skipped = false;

  for (const step of mainSteps) {
    const executed = await runStep(step);
    stepResults.push(executed.result);

    if (executed.result.status === "skipped") {
      skipped = true;
      break;
    }

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
        attachments: [],
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
    attachments,
    steps: stepResults,
    ...(skipped ? { skipped: true } : {}),
  };
  return failure ? { ...resultBase, failure } : resultBase;
}
