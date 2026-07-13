import {
  defineScenario,
  defineStep,
  standardStepTypes,
  type Scenario,
  type ScenarioDefinitionInput,
  type ScenarioStep,
  type StepDefinitionInput,
  type StepExecutor,
} from "./domain.js";
import { slugify } from "./slug.js";

export interface GivenOptions {
  /**
   * Custom acceptance criteria id for the sub-scenario started by this
   * "given" step, used instead of the auto-generated `{acceptance}-{index}`
   * id (e.g. `AC-001-01`). Only relevant when the scenario contains more
   * than one "given" step.
   */
  readonly acceptance?: string;
}

/** Step input accepted by the builder's typed step methods; `id` is optional (derived from `name`). */
export type BuilderStepInput<TContext extends object> = Omit<StepDefinitionInput<TContext>, "type">;

export interface ScenarioBuilder<TContext extends object> {
  acceptance(...ids: ReadonlyArray<string>): ScenarioBuilder<TContext>;
  dependsOn(...scenarioIds: ReadonlyArray<string>): ScenarioBuilder<TContext>;
  description(text: string): ScenarioBuilder<TContext>;
  tag(...tags: ReadonlyArray<string>): ScenarioBuilder<TContext>;
  metadata(values: Record<string, unknown>): ScenarioBuilder<TContext>;
  step(step: ScenarioStep<TContext> | StepDefinitionInput<TContext>): ScenarioBuilder<TContext>;
  setup(step: BuilderStepInput<TContext>): ScenarioBuilder<TContext>;
  setup(name: string, execute: StepExecutor<TContext>): ScenarioBuilder<TContext>;
  given(step: BuilderStepInput<TContext>, options?: GivenOptions): ScenarioBuilder<TContext>;
  given(
    name: string,
    execute: StepExecutor<TContext>,
    options?: GivenOptions,
  ): ScenarioBuilder<TContext>;
  when(step: BuilderStepInput<TContext>): ScenarioBuilder<TContext>;
  when(name: string, execute: StepExecutor<TContext>): ScenarioBuilder<TContext>;
  then(step: BuilderStepInput<TContext>): ScenarioBuilder<TContext>;
  then(name: string, execute: StepExecutor<TContext>): ScenarioBuilder<TContext>;
  cleanup(
    step: Omit<StepDefinitionInput<TContext>, "type" | "lifecycle">,
  ): ScenarioBuilder<TContext>;
  cleanup(name: string, execute: StepExecutor<TContext>): ScenarioBuilder<TContext>;
  /**
   * Controls whether multiple "given" steps split the scenario into
   * independently executed sub-scenarios. Enabled by default; call
   * `.splitOnGiven(false)` to run all steps as one linear scenario.
   */
  splitOnGiven(enabled: boolean): ScenarioBuilder<TContext>;
  build(): Scenario<TContext>;
}

interface ScenarioBuilderState<TContext extends object> {
  id: string;
  title: string;
  description?: string;
  acceptance: Array<string>;
  dependsOn: Array<string>;
  tags: Array<string>;
  metadata: Record<string, unknown>;
  steps: Array<ScenarioStep<TContext> | StepDefinitionInput<TContext>>;
  splitOnGiven?: boolean;
}

function createTypedStep<TContext extends object>(
  type: string,
  input: BuilderStepInput<TContext>,
): ScenarioStep<TContext> {
  const definition = standardStepTypes.get(type);

  return defineStep({
    ...input,
    type,
    lifecycle: input.lifecycle ?? definition?.lifecycle ?? "main",
  });
}

function normalizeStepInput<TContext extends object>(
  stepOrName: BuilderStepInput<TContext> | string,
  execute?: StepExecutor<TContext>,
): BuilderStepInput<TContext> {
  if (typeof stepOrName !== "string") {
    return stepOrName;
  }

  if (execute === undefined) {
    throw new Error(`Step "${stepOrName}" is missing its execute function`);
  }

  return { name: stepOrName, execute };
}

/**
 * Starts a fluent scenario builder. The id can be omitted — it is then
 * derived by slugifying the title (`scenario("Registered user logs in")`
 * gets the id `registered-user-logs-in`).
 */
export function scenario<TContext extends object = Record<string, unknown>>(
  title: string,
): ScenarioBuilder<TContext>;
export function scenario<TContext extends object = Record<string, unknown>>(
  id: string,
  title: string,
): ScenarioBuilder<TContext>;
export function scenario<TContext extends object = Record<string, unknown>>(
  idOrTitle: string,
  maybeTitle?: string,
): ScenarioBuilder<TContext> {
  const state: ScenarioBuilderState<TContext> = {
    id: maybeTitle === undefined ? slugify(idOrTitle, "scenario") : idOrTitle,
    title: maybeTitle ?? idOrTitle,
    acceptance: [],
    dependsOn: [],
    tags: [],
    metadata: {},
    steps: [],
  };

  const builder: ScenarioBuilder<TContext> = {
    acceptance(...ids) {
      state.acceptance = [...(state.acceptance ?? []), ...ids];
      return builder;
    },
    dependsOn(...scenarioIds) {
      state.dependsOn = [...(state.dependsOn ?? []), ...scenarioIds];
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
    setup(stepOrName: BuilderStepInput<TContext> | string, execute?: StepExecutor<TContext>) {
      return builder.step(createTypedStep("setup", normalizeStepInput(stepOrName, execute)));
    },
    given(
      stepOrName: BuilderStepInput<TContext> | string,
      executeOrOptions?: StepExecutor<TContext> | GivenOptions,
      maybeOptions?: GivenOptions,
    ) {
      const usingShorthand = typeof stepOrName === "string";
      const stepInput = normalizeStepInput(
        stepOrName,
        usingShorthand ? (executeOrOptions as StepExecutor<TContext>) : undefined,
      );
      const options = usingShorthand
        ? maybeOptions
        : (executeOrOptions as GivenOptions | undefined);
      const acceptance = options?.acceptance;

      return builder.step(
        createTypedStep(
          "given",
          acceptance !== undefined ? { ...stepInput, acceptance } : stepInput,
        ),
      );
    },
    when(stepOrName: BuilderStepInput<TContext> | string, execute?: StepExecutor<TContext>) {
      return builder.step(createTypedStep("when", normalizeStepInput(stepOrName, execute)));
    },
    then(stepOrName: BuilderStepInput<TContext> | string, execute?: StepExecutor<TContext>) {
      return builder.step(createTypedStep("then", normalizeStepInput(stepOrName, execute)));
    },
    cleanup(
      stepOrName: Omit<StepDefinitionInput<TContext>, "type" | "lifecycle"> | string,
      execute?: StepExecutor<TContext>,
    ) {
      return builder.step(createTypedStep("cleanup", normalizeStepInput(stepOrName, execute)));
    },
    splitOnGiven(enabled) {
      state.splitOnGiven = enabled;
      return builder;
    },
    build() {
      const input = {
        id: state.id,
        title: state.title,
        acceptance: state.acceptance,
        ...(state.dependsOn.length > 0 ? { dependsOn: state.dependsOn } : {}),
        ...(state.splitOnGiven !== undefined ? { splitOnGiven: state.splitOnGiven } : {}),
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
