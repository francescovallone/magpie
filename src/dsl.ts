import {
  defineScenario,
  defineStep,
  standardStepTypes,
  type Scenario,
  type ScenarioDefinitionInput,
  type ScenarioStep,
  type StepDefinitionInput,
} from "./domain.js";

export interface ScenarioBuilder<TContext extends object> {
  acceptance(...ids: ReadonlyArray<string>): ScenarioBuilder<TContext>;
  description(text: string): ScenarioBuilder<TContext>;
  tag(...tags: ReadonlyArray<string>): ScenarioBuilder<TContext>;
  metadata(values: Record<string, unknown>): ScenarioBuilder<TContext>;
  step(step: ScenarioStep<TContext> | StepDefinitionInput<TContext>): ScenarioBuilder<TContext>;
  setup(step: Omit<StepDefinitionInput<TContext>, "type">): ScenarioBuilder<TContext>;
  given(step: Omit<StepDefinitionInput<TContext>, "type">): ScenarioBuilder<TContext>;
  when(step: Omit<StepDefinitionInput<TContext>, "type">): ScenarioBuilder<TContext>;
  then(step: Omit<StepDefinitionInput<TContext>, "type">): ScenarioBuilder<TContext>;
  cleanup(step: Omit<StepDefinitionInput<TContext>, "type" | "lifecycle">): ScenarioBuilder<TContext>;
  build(): Scenario<TContext>;
}

interface ScenarioBuilderState<TContext extends object> {
  id: string;
  title: string;
  description?: string;
  acceptance: Array<string>;
  tags: Array<string>;
  metadata: Record<string, unknown>;
  steps: Array<ScenarioStep<TContext> | StepDefinitionInput<TContext>>;
}

function createTypedStep<TContext extends object>(
  type: string,
  input: Omit<StepDefinitionInput<TContext>, "type">,
): ScenarioStep<TContext> {
  const definition = standardStepTypes.get(type);

  return defineStep({
    ...input,
    type,
    lifecycle: input.lifecycle ?? definition?.lifecycle ?? "main",
  });
}

export function scenario<TContext extends object = Record<string, unknown>>(
  id: string,
  title: string,
): ScenarioBuilder<TContext> {
  const state: ScenarioBuilderState<TContext> = {
    id,
    title,
    acceptance: [],
    tags: [],
    metadata: {},
    steps: [],
  };

  const builder: ScenarioBuilder<TContext> = {
    acceptance(...ids) {
      state.acceptance = [...(state.acceptance ?? []), ...ids];
      return builder;
    },
    description(text) {
      state.description = text;
      return builder;
    },
    tag(...tags) {
      state.tags = [...(state.tags ?? []), ...tags];
      return builder;
    },
    metadata(values) {
      state.metadata = { ...(state.metadata ?? {}), ...values };
      return builder;
    },
    step(nextStep) {
      state.steps = [...state.steps, nextStep];
      return builder;
    },
    setup(stepInput) {
      return builder.step(createTypedStep("setup", stepInput));
    },
    given(stepInput) {
      return builder.step(createTypedStep("given", stepInput));
    },
    when(stepInput) {
      return builder.step(createTypedStep("when", stepInput));
    },
    then(stepInput) {
      return builder.step(createTypedStep("then", stepInput));
    },
    cleanup(stepInput) {
      return builder.step(createTypedStep("cleanup", stepInput));
    },
    build() {
      const input = {
        id: state.id,
        title: state.title,
        acceptance: state.acceptance,
        tags: state.tags,
        metadata: state.metadata,
        steps: state.steps,
      } as const;

      return state.description === undefined
        ? defineScenario(input)
        : defineScenario({
            ...input,
            description: state.description,
          });
    },
  };

  return builder;
}

export function defineAcceptanceScenario<TContext extends object>(
  input: ScenarioDefinitionInput<TContext>,
): Scenario<TContext> {
  return defineScenario(input);
}