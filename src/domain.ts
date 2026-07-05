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
  });
}

export function defineScenario<TContext extends object>(
  input: ScenarioDefinitionInput<TContext>,
): Scenario<TContext> {
  const steps: ReadonlyArray<ScenarioStep<TContext>> = Object.freeze(
    input.steps.map((step) => (isScenarioStep(step) ? step : defineStep(step))),
  );

  const scenario: Scenario<TContext> = {
    id: input.id,
    title: input.title,
    acceptance: Object.freeze([...(input.acceptance ?? [])]),
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

  return deepFreeze(scenario);
}

export function defineStory<TContext extends object>(
  input: StoryDefinitionInput<TContext>,
): Story<TContext> {
  const scenarios: ReadonlyArray<Scenario<TContext>> = Object.freeze(
    input.scenarios.map((scenario) =>
      isScenarioDefinition(scenario) ? scenario : defineScenario(scenario),
    ),
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