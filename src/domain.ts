export type StepLifecycle = "main" | "cleanup";

export interface StepTypeDefinition {
  readonly id: string;
  readonly label: string;
  readonly lifecycle?: StepLifecycle;
}

export interface StepTypeRegistry {
  readonly definitions: ReadonlyMap<string, StepTypeDefinition>;
  has(id: string): boolean;
  get(id: string): StepTypeDefinition | undefined;
  extend(...definitions: ReadonlyArray<StepTypeDefinition>): StepTypeRegistry;
  list(): ReadonlyArray<StepTypeDefinition>;
}

export type Metadata = Readonly<Record<string, unknown>>;
export type AcceptanceReference = string;

export interface StepExecutionApi<TContext extends object> {
  readonly log: (message: string, data?: unknown) => void;
  readonly context: TContext;
}

export type StepExecutor<TContext extends object> = (
  context: TContext,
  api: StepExecutionApi<TContext>,
) => Promise<void> | void;

export interface ScenarioStep<TContext extends object = Record<string, unknown>> {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly lifecycle: StepLifecycle;
  readonly metadata: Metadata;
  readonly execute: StepExecutor<TContext>;
  /**
   * Custom acceptance criteria id for the sub-scenario started by this step.
   * Only meaningful on "given" steps; ignored otherwise. When omitted, a
   * sub-scenario id is auto-generated (see `defineScenario`).
   */
  readonly acceptance?: AcceptanceReference;
}

/**
 * A scenario is split into sub-scenarios whenever it contains more than one
 * "given" step. Each sub-scenario starts at a "given" step and includes every
 * following step up to (but excluding) the next "given" step, plus any steps
 * that appear before the first "given" (e.g. "setup" steps). Sub-scenarios
 * are executed independently, but a failing sub-scenario fails the parent
 * scenario as a whole.
 */
export interface SubScenario<TContext extends object = Record<string, unknown>> {
  readonly id: string;
  readonly acceptance: ReadonlyArray<AcceptanceReference>;
  readonly steps: ReadonlyArray<ScenarioStep<TContext>>;
}

export interface StoryReference {
  readonly id?: string;
  readonly title: string;
  readonly description?: string;
}

export interface Scenario<TContext extends object = Record<string, unknown>> {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly acceptance: ReadonlyArray<AcceptanceReference>;
  readonly dependsOn?: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly metadata: Metadata;
  readonly steps: ReadonlyArray<ScenarioStep<TContext>>;
  readonly story?: StoryReference;
  /**
   * Present when the scenario contains more than one "given" step. See
   * `SubScenario` for details on how steps are grouped.
   */
  readonly subScenarios?: ReadonlyArray<SubScenario<TContext>>;
}

export interface Story<TContext extends object = Record<string, unknown>> {
  readonly id?: string;
  readonly title: string;
  readonly description?: string;
  readonly metadata: Metadata;
  readonly scenarios: ReadonlyArray<Scenario<TContext>>;
}

export interface StepDefinitionInput<TContext extends object> {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly execute: StepExecutor<TContext>;
  readonly lifecycle?: StepLifecycle;
  readonly metadata?: Record<string, unknown>;
  /** Custom acceptance criteria id for the sub-scenario started by this step (see `ScenarioStep.acceptance`). */
  readonly acceptance?: AcceptanceReference;
}

export interface ScenarioDefinitionInput<TContext extends object> {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly acceptance?: ReadonlyArray<AcceptanceReference>;
  readonly dependsOn?: ReadonlyArray<string>;
  readonly tags?: ReadonlyArray<string>;
  readonly metadata?: Record<string, unknown>;
  readonly steps: ReadonlyArray<ScenarioStep<TContext> | StepDefinitionInput<TContext>>;
  readonly story?: StoryReference;
}

export interface StoryDefinitionInput<TContext extends object> {
  readonly id?: string;
  readonly title: string;
  readonly description?: string;
  readonly metadata?: Record<string, unknown>;
  readonly scenarios: ReadonlyArray<Scenario<TContext> | ScenarioDefinitionInput<TContext>>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);

    for (const property of Object.values(value as Record<string, unknown>)) {
      deepFreeze(property);
    }
  }

  return value;
}

function cloneMetadata(metadata?: Record<string, unknown>): Metadata {
  return deepFreeze({ ...(metadata ?? {}) });
}

function isScenarioStep<TContext extends object>(
  step: ScenarioStep<TContext> | StepDefinitionInput<TContext>,
): step is ScenarioStep<TContext> {
  return "lifecycle" in step && "metadata" in step;
}

function isScenarioDefinition<TContext extends object>(
  scenario: Scenario<TContext> | ScenarioDefinitionInput<TContext>,
): scenario is Scenario<TContext> {
  return "acceptance" in scenario && "tags" in scenario && "metadata" in scenario;
}

function createRegistry(definitions: ReadonlyMap<string, StepTypeDefinition>): StepTypeRegistry {
  return Object.freeze({
    definitions,
    has(id: string) {
      return definitions.has(id);
    },
    get(id: string) {
      return definitions.get(id);
    },
    extend(...nextDefinitions: ReadonlyArray<StepTypeDefinition>) {
      const merged = new Map(definitions);

      for (const definition of nextDefinitions) {
        merged.set(definition.id, deepFreeze({ lifecycle: "main", ...definition }));
      }

      return createRegistry(merged);
    },
    list() {
      return Object.freeze(Array.from(definitions.values()));
    },
  });
}

export function createStepTypeRegistry(
  definitions: ReadonlyArray<StepTypeDefinition> = [],
): StepTypeRegistry {
  return createRegistry(new Map()).extend(...definitions);
}

export const standardStepTypes = createStepTypeRegistry([
  { id: "setup", label: "Setup" },
  { id: "given", label: "Given" },
  { id: "when", label: "When" },
  { id: "then", label: "Then" },
  { id: "cleanup", label: "Cleanup", lifecycle: "cleanup" },
]);

export function defineStep<TContext extends object>(
  input: StepDefinitionInput<TContext>,
): ScenarioStep<TContext> {
  return deepFreeze({
    id: input.id,
    name: input.name,
    type: input.type,
    lifecycle: input.lifecycle ?? "main",
    metadata: cloneMetadata(input.metadata),
    execute: input.execute,
    ...(input.acceptance !== undefined ? { acceptance: input.acceptance } : {}),
  });
}

function padSubScenarioIndex(index: number): string {
  return String(index).padStart(2, "0");
}

/**
 * Splits a scenario's main (non-cleanup) steps into sub-scenarios whenever
 * more than one "given" step is present. Returns `undefined` when the
 * scenario has zero or one "given" steps (i.e. sub-scenarios are disabled).
 */
function buildSubScenarios<TContext extends object>(
  scenarioId: string,
  scenarioAcceptance: ReadonlyArray<AcceptanceReference>,
  steps: ReadonlyArray<ScenarioStep<TContext>>,
): ReadonlyArray<SubScenario<TContext>> | undefined {
  const mainSteps = steps.filter((step) => step.lifecycle !== "cleanup");
  const givenIndexes = mainSteps.reduce<Array<number>>((indexes, step, index) => {
    if (step.type === "given") {
      indexes.push(index);
    }

    return indexes;
  }, []);

  if (givenIndexes.length <= 1) {
    return undefined;
  }

  const prefixSteps = mainSteps.slice(0, givenIndexes[0]!);

  return Object.freeze(
    givenIndexes.map((startIndex, order) => {
      const endIndex = givenIndexes[order + 1] ?? mainSteps.length;
      const segmentSteps = mainSteps.slice(startIndex, endIndex);
      const givenStep = mainSteps[startIndex]!;
      const suffix = padSubScenarioIndex(order + 1);
      const customAcceptance = givenStep.acceptance;

      const acceptance = customAcceptance
        ? Object.freeze([customAcceptance])
        : Object.freeze(
            scenarioAcceptance.length > 0
              ? scenarioAcceptance.map((id) => `${id}-${suffix}`)
              : [`${scenarioId}-${suffix}`],
          );

      return deepFreeze({
        id: customAcceptance ?? `${scenarioId}-${suffix}`,
        acceptance,
        steps: Object.freeze([...prefixSteps, ...segmentSteps]),
      });
    }),
  );
}

export function defineScenario<TContext extends object>(
  input: ScenarioDefinitionInput<TContext>,
): Scenario<TContext> {
  const steps: ReadonlyArray<ScenarioStep<TContext>> = Object.freeze(
    input.steps.map((step) => (isScenarioStep(step) ? step : defineStep(step))),
  );

  const acceptance = Object.freeze([...(input.acceptance ?? [])]);

  const scenario: Scenario<TContext> = {
    id: input.id,
    title: input.title,
    acceptance,
    tags: Object.freeze([...(input.tags ?? [])]),
    metadata: cloneMetadata(input.metadata),
    steps,
  };

  if (input.description !== undefined) {
    Object.assign(scenario, { description: input.description });
  }

  if (input.dependsOn !== undefined) {
    Object.assign(scenario, { dependsOn: Object.freeze([...input.dependsOn]) });
  }

  if (input.story) {
    Object.assign(scenario, { story: deepFreeze({ ...input.story }) });
  }

  const subScenarios = buildSubScenarios(input.id, acceptance, steps);

  if (subScenarios !== undefined) {
    Object.assign(scenario, { subScenarios });
  }

  return deepFreeze(scenario);
}

export function defineStory<TContext extends object>(
  input: StoryDefinitionInput<TContext>,
): Story<TContext> {
  const storyReference: StoryReference = {
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    title: input.title,
  };

  const scenarios: ReadonlyArray<Scenario<TContext>> = Object.freeze(
    input.scenarios.map((scenario) => {
      if (isScenarioDefinition(scenario)) {
        return scenario.story ? scenario : deepFreeze({ ...scenario, story: storyReference });
      }

      return defineScenario({ ...scenario, story: scenario.story ?? storyReference });
    }),
  );

  const story: Story<TContext> = {
    title: input.title,
    metadata: cloneMetadata(input.metadata),
    scenarios,
  };

  if (input.id !== undefined) {
    Object.assign(story, { id: input.id });
  }

  if (input.description !== undefined) {
    Object.assign(story, { description: input.description });
  }

  return deepFreeze(story);
}