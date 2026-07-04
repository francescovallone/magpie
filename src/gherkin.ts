import { readFile } from "node:fs/promises";

import { CucumberExpression, ParameterTypeRegistry } from "@cucumber/cucumber-expressions";
import { generateMessages } from "@cucumber/gherkin";
import {
  IdGenerator,
  SourceMediaType,
  StepKeywordType,
  type Background,
  type Feature,
  type GherkinDocument,
  type Pickle,
  type PickleStep,
  type Rule,
  type Scenario as GherkinScenario,
  type Step,
  type Tag,
} from "@cucumber/messages";

import { defineScenario, defineStory, defineStep, type Scenario, type Story } from "./domain.js";

export interface GherkinStepArgumentDataTable {
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}

export interface GherkinStepArgumentDocString {
  readonly content: string;
  readonly mediaType?: string;
}

export interface GherkinStepArgument {
  readonly docString?: GherkinStepArgumentDocString;
  readonly dataTable?: GherkinStepArgumentDataTable;
}

export interface GherkinStepMatch<TContext extends object> {
  readonly text: string;
  readonly keyword: string;
  readonly type: string;
  readonly arguments: ReadonlyArray<unknown>;
  readonly argumentData?: GherkinStepArgument;
  readonly context: TContext;
}

export interface GherkinStepDefinition<TContext extends object> {
  readonly id: string;
  readonly expression: string;
  readonly execute: (match: GherkinStepMatch<TContext>) => Promise<void> | void;
}

export interface GherkinStepDefinitionInput<TContext extends object> {
  readonly id?: string;
  readonly expression: string;
  readonly execute: (match: GherkinStepMatch<TContext>) => Promise<void> | void;
}

export interface GherkinImportOptions<TContext extends object> {
  readonly uri?: string;
  readonly defaultDialect?: string;
  readonly stepDefinitions: ReadonlyArray<GherkinStepDefinition<TContext>>;
  readonly acceptanceTagPrefix?: string;
  readonly acceptanceTagPattern?: RegExp | string;
  readonly acceptanceMetadataPattern?: RegExp | string;
  readonly metadata?: Record<string, unknown>;
}

export interface GherkinAcceptanceSource {
  readonly tags: ReadonlyArray<string>;
  readonly feature: {
    readonly name: string;
    readonly description: string;
  };
  readonly scenario: {
    readonly name: string;
    readonly description: string;
  };
  readonly rule?: {
    readonly name: string;
    readonly description: string;
  };
}

interface CompiledStepDefinition<TContext extends object> {
  readonly id: string;
  readonly expression: string;
  readonly compiledExpression: CucumberExpression;
  readonly execute: (match: GherkinStepMatch<TContext>) => Promise<void> | void;
}

interface PickleSourceInfo {
  readonly feature: Feature;
  readonly scenario: GherkinScenario;
  readonly rule?: Rule;
  readonly backgroundSteps: ReadonlyArray<Step>;
  readonly stepByAstNodeId: ReadonlyMap<string, Step>;
}

interface GherkinArtifacts {
  readonly gherkinDocument: GherkinDocument;
  readonly pickles: ReadonlyArray<Pickle>;
}

function normalizeTag(tag: string): string {
  return tag.startsWith("@") ? tag.slice(1) : tag;
}

function toGlobalRegExp(value: RegExp | string): RegExp {
  if (value instanceof RegExp) {
    const flags = value.flags.includes("g") ? value.flags : `${value.flags}g`;
    return new RegExp(value.source, flags);
  }

  return new RegExp(value, "g");
}

function extractMatches(text: string, matcher: RegExp | string): ReadonlyArray<string> {
  const expression = toGlobalRegExp(matcher);
  const matches: Array<string> = [];

  for (const match of text.matchAll(expression)) {
    matches.push(match[1] ?? match[0]);
  }

  return matches;
}

function toStepType(keywordType: StepKeywordType | undefined): string {
  switch (keywordType) {
    case StepKeywordType.CONTEXT:
      return "given";
    case StepKeywordType.ACTION:
      return "when";
    case StepKeywordType.OUTCOME:
      return "then";
    case StepKeywordType.CONJUNCTION:
      return "and";
    default:
      return "step";
  }
}

function toStepArgument(pickleStep: PickleStep): GherkinStepArgument | undefined {
  if (!pickleStep.argument) {
    return undefined;
  }

  const argument: GherkinStepArgument = {};

  if (pickleStep.argument.docString) {
    Object.assign(argument, {
      docString: {
        ...(pickleStep.argument.docString.mediaType
          ? { mediaType: pickleStep.argument.docString.mediaType }
          : {}),
        content: pickleStep.argument.docString.content,
      },
    });
  }

  if (pickleStep.argument.dataTable) {
    Object.assign(argument, {
      dataTable: {
        rows: Object.freeze(
          pickleStep.argument.dataTable.rows.map((row) => Object.freeze(row.cells.map((cell) => cell.value))),
        ),
      },
    });
  }

  return Object.keys(argument).length === 0 ? undefined : argument;
}

function compileStepDefinitions<TContext extends object>(
  definitions: ReadonlyArray<GherkinStepDefinition<TContext>>,
): ReadonlyArray<CompiledStepDefinition<TContext>> {
  const parameterTypeRegistry = new ParameterTypeRegistry();

  return definitions.map((definition) => ({
    ...definition,
    compiledExpression: new CucumberExpression(definition.expression, parameterTypeRegistry),
  }));
}

function createGherkinArtifacts(featureText: string, uri: string, defaultDialect?: string): GherkinArtifacts {
  const options = {
    includeGherkinDocument: true,
    includePickles: true,
    includeSource: false,
    newId: IdGenerator.uuid(),
  } as const;
  const envelopes = generateMessages(
    featureText,
    uri,
    SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN,
    defaultDialect === undefined ? options : { ...options, defaultDialect },
  );
  const gherkinDocument = envelopes.find((envelope) => envelope.gherkinDocument)?.gherkinDocument;
  const pickles = envelopes
    .map((envelope) => envelope.pickle)
    .filter((pickle): pickle is Pickle => pickle !== undefined);

  if (!gherkinDocument) {
    throw new Error(`Unable to parse Gherkin document from ${uri}`);
  }

  return {
    gherkinDocument,
    pickles,
  };
}

function collectScenarioSources(feature: Feature): ReadonlyMap<string, PickleSourceInfo> {
  const sourceByScenarioId = new Map<string, PickleSourceInfo>();

  const registerScenario = (
    scenario: GherkinScenario,
    backgroundSteps: ReadonlyArray<Step>,
    rule?: Rule,
  ) => {
    const stepByAstNodeId = new Map<string, Step>();

    for (const step of [...backgroundSteps, ...scenario.steps]) {
      stepByAstNodeId.set(step.id, step);
    }

    sourceByScenarioId.set(scenario.id, {
      feature,
      scenario,
      ...(rule ? { rule } : {}),
      backgroundSteps,
      stepByAstNodeId,
    });
  };

  let featureBackgroundSteps: ReadonlyArray<Step> = [];

  for (const child of feature.children) {
    if (child.background) {
      featureBackgroundSteps = child.background.steps;
      continue;
    }

    if (child.scenario) {
      registerScenario(child.scenario, featureBackgroundSteps);
      continue;
    }

    if (child.rule) {
      let ruleBackgroundSteps: ReadonlyArray<Step> = featureBackgroundSteps;

      for (const ruleChild of child.rule.children) {
        if (ruleChild.background) {
          ruleBackgroundSteps = [...featureBackgroundSteps, ...ruleChild.background.steps];
          continue;
        }

        if (ruleChild.scenario) {
          registerScenario(ruleChild.scenario, ruleBackgroundSteps, child.rule);
        }
      }
    }
  }

  return sourceByScenarioId;
}

function createPickleSourceLookup(gherkinDocument: GherkinDocument): ReadonlyMap<string, PickleSourceInfo> {
  const feature = gherkinDocument.feature;

  if (!feature) {
    throw new Error("Gherkin document did not contain a feature.");
  }

  return collectScenarioSources(feature);
}

function findSourceInfoForPickle(
  pickle: Pickle,
  sourceLookup: ReadonlyMap<string, PickleSourceInfo>,
): PickleSourceInfo {
  for (const astNodeId of pickle.astNodeIds) {
    const sourceInfo = sourceLookup.get(astNodeId);
    if (sourceInfo) {
      return sourceInfo;
    }
  }

  throw new Error(`Unable to locate source scenario for pickle: ${pickle.name}`);
}

function extractAcceptance(
  source: GherkinAcceptanceSource,
  options: GherkinImportOptions<object>,
): ReadonlyArray<string> {
  const acceptance = new Set<string>();
  const prefixes = options.acceptanceTagPrefix ? [options.acceptanceTagPrefix] : ["AUTH-"];

  for (const tag of source.tags) {
    for (const prefix of prefixes) {
      if (tag.toUpperCase().startsWith(prefix.toUpperCase())) {
        acceptance.add(tag.slice(prefix.length));
      }
    }
  }

  if (options.acceptanceTagPattern) {
    for (const tag of source.tags) {
      for (const match of extractMatches(tag, options.acceptanceTagPattern)) {
        acceptance.add(match);
      }
    }
  }

  if (options.acceptanceMetadataPattern) {
    const metadataTexts = [
      source.feature.description,
      source.rule?.description ?? "",
      source.scenario.description,
    ];

    for (const text of metadataTexts) {
      for (const match of extractMatches(text, options.acceptanceMetadataPattern)) {
        acceptance.add(match);
      }
    }
  }

  return Object.freeze(Array.from(acceptance));
}

function resolveCompiledStep<TContext extends object>(
  compiledDefinitions: ReadonlyArray<CompiledStepDefinition<TContext>>,
  pickleStep: PickleStep,
): { definition: CompiledStepDefinition<TContext>; arguments: ReadonlyArray<unknown> } {
  const matches = compiledDefinitions.flatMap((definition) => {
    const args = definition.compiledExpression.match(pickleStep.text);
    return args ? [{ definition, arguments: args.map((arg) => arg.getValue<unknown>(undefined)) }] : [];
  });

  if (matches.length === 0) {
    throw new Error(`No Cucumber step definition matched: ${pickleStep.text}`);
  }

  if (matches.length > 1) {
    throw new Error(`Ambiguous Cucumber step definitions matched: ${pickleStep.text}`);
  }

  return matches[0]!;
}

function createStepId(scenarioId: string, pickleStep: PickleStep, step: Step | undefined): string {
  return step?.id ?? `${scenarioId}:${pickleStep.id}`;
}

function createScenarioSteps<TContext extends object>(
  scenarioId: string,
  pickle: Pickle,
  sourceInfo: PickleSourceInfo,
  compiledDefinitions: ReadonlyArray<CompiledStepDefinition<TContext>>,
) {
  return pickle.steps.map((pickleStep) => {
    const sourceStep = pickleStep.astNodeIds
      .map((astNodeId) => sourceInfo.stepByAstNodeId.get(astNodeId))
      .find((step): step is Step => step !== undefined);
    const { definition, arguments: matchedArguments } = resolveCompiledStep(compiledDefinitions, pickleStep);
    const argumentData = toStepArgument(pickleStep);
    const keyword = sourceStep?.keyword ?? "";
    const type = toStepType(sourceStep?.keywordType);

    return defineStep<TContext>({
      id: createStepId(scenarioId, pickleStep, sourceStep),
      name: pickleStep.text,
      type,
      metadata: {
        expression: definition.expression,
        gherkin: {
          ...(argumentData ? { argument: argumentData } : {}),
          astNodeIds: pickleStep.astNodeIds,
          keyword,
          pickleStepId: pickleStep.id,
          sourceStepId: sourceStep?.id,
          text: pickleStep.text,
        },
      },
      execute: async (context) => {
        await definition.execute({
          text: pickleStep.text,
          keyword,
          type,
          arguments: matchedArguments,
          ...(argumentData ? { argumentData } : {}),
          context,
        });
      },
    });
  });
}

function createStoryMetadata(feature: Feature, rule?: Rule, metadata?: Record<string, unknown>) {
  return {
    ...(metadata ?? {}),
    gherkin: {
      feature: {
        id: feature.name,
        language: feature.language,
        name: feature.name,
      },
      ...(rule
        ? {
            rule: {
              id: rule.id,
              name: rule.name,
            },
          }
        : {}),
    },
  };
}

function createScenarioDescription(
  sourceInfo: PickleSourceInfo,
  pickle: Pickle,
): string | undefined {
  const parts = [sourceInfo.scenario.description];
  const exampleTagNames = pickle.tags
    .map((tag) => normalizeTag(tag.name))
    .filter((tag) => tag.startsWith("example:"));

  if (exampleTagNames.length) {
    parts.push(`Examples: ${exampleTagNames.join(", ")}`);
  }

  const description = parts.filter(Boolean).join("\n\n").trim();
  return description || undefined;
}

function toScenarioTags(tags: ReadonlyArray<Tag>, pickle: Pickle): ReadonlyArray<string> {
  return Object.freeze(
    Array.from(
      new Set([
        ...tags.map((tag) => normalizeTag(tag.name)),
        ...pickle.tags.map((tag) => normalizeTag(tag.name)),
      ]),
    ),
  );
}

export function defineGherkinStep<TContext extends object>(
  input: GherkinStepDefinitionInput<TContext>,
): GherkinStepDefinition<TContext> {
  return Object.freeze({
    id: input.id ?? input.expression,
    expression: input.expression,
    execute: input.execute,
  });
}

export function createGherkinStory<TContext extends object>(
  featureText: string,
  options: GherkinImportOptions<TContext>,
): Story<TContext> {
  const uri = options.uri ?? "feature.feature";
  const { gherkinDocument, pickles } = createGherkinArtifacts(featureText, uri, options.defaultDialect);
  const sourceLookup = createPickleSourceLookup(gherkinDocument);
  const compiledDefinitions = compileStepDefinitions(options.stepDefinitions);
  const feature = gherkinDocument.feature;

  if (!feature) {
    throw new Error(`Unable to parse Gherkin feature from ${uri}`);
  }

  const scenarios = pickles.map((pickle) => {
    const sourceInfo = findSourceInfoForPickle(pickle, sourceLookup);
    const tags = toScenarioTags(sourceInfo.scenario.tags, pickle);
    const storyTitle = sourceInfo.rule?.name ?? feature.name;
    const acceptanceSource: GherkinAcceptanceSource = {
      tags,
      feature: {
        name: feature.name,
        description: feature.description,
      },
      scenario: {
        name: sourceInfo.scenario.name,
        description: sourceInfo.scenario.description,
      },
      ...(sourceInfo.rule
        ? {
            rule: {
              name: sourceInfo.rule.name,
              description: sourceInfo.rule.description,
            },
          }
        : {}),
    };

    return defineScenario<TContext>({
      id: pickle.id,
      title: pickle.name,
      ...(createScenarioDescription(sourceInfo, pickle)
        ? { description: createScenarioDescription(sourceInfo, pickle)! }
        : {}),
      acceptance: extractAcceptance(acceptanceSource, options as GherkinImportOptions<object>),
      tags,
      metadata: {
        ...(options.metadata ?? {}),
        gherkin: {
          feature: {
            language: feature.language,
            name: feature.name,
            uri,
          },
          ...(sourceInfo.rule
            ? {
                rule: {
                  id: sourceInfo.rule.id,
                  name: sourceInfo.rule.name,
                },
              }
            : {}),
          scenario: {
            id: sourceInfo.scenario.id,
            keyword: sourceInfo.scenario.keyword,
            name: sourceInfo.scenario.name,
          },
        },
      },
      steps: createScenarioSteps(pickle.id, pickle, sourceInfo, compiledDefinitions),
      story: {
        ...(sourceInfo.rule ? { id: sourceInfo.rule.id } : {}),
        title: storyTitle,
        ...(sourceInfo.rule?.description || feature.description
          ? { description: sourceInfo.rule?.description || feature.description }
          : {}),
      },
    });
  });

  return defineStory<TContext>({
    title: feature.name,
    ...(feature.description ? { description: feature.description } : {}),
    metadata: createStoryMetadata(feature, undefined, options.metadata),
    scenarios,
  });
}

export function createGherkinScenarios<TContext extends object>(
  featureText: string,
  options: GherkinImportOptions<TContext>,
): ReadonlyArray<Scenario<TContext>> {
  return createGherkinStory(featureText, options).scenarios;
}

export async function createGherkinStoryFromFile<TContext extends object>(
  filePath: string,
  options: Omit<GherkinImportOptions<TContext>, "uri">,
): Promise<Story<TContext>> {
  const featureText = await readFile(filePath, "utf8");
  return createGherkinStory(featureText, {
    ...options,
    uri: filePath,
  });
}

export async function createGherkinScenariosFromFile<TContext extends object>(
  filePath: string,
  options: Omit<GherkinImportOptions<TContext>, "uri">,
): Promise<ReadonlyArray<Scenario<TContext>>> {
  const story = await createGherkinStoryFromFile(filePath, options);
  return story.scenarios;
}