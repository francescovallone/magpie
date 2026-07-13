import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { CucumberExpression, ParameterTypeRegistry } from "@cucumber/cucumber-expressions";
import { generateMessages } from "@cucumber/gherkin";
import {
  IdGenerator,
  SourceMediaType,
  StepKeywordType,
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
import { slugify } from "./slug.js";

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

/**
 * A shared, mergeable collection of Gherkin step definitions. Create one per
 * project (or per domain), register steps into it from any module, and pass
 * it as `stepDefinitions` wherever an array of definitions is accepted.
 */
export interface GherkinStepRegistry<TContext extends object = Record<string, unknown>> {
  readonly stepDefinitions: ReadonlyArray<GherkinStepDefinition<TContext>>;
  /** Defines a step (same input as `defineGherkinStep`) and adds it to the registry. Chainable. */
  define(input: GherkinStepDefinitionInput<TContext>): GherkinStepRegistry<TContext>;
  /** Adds already-created step definitions. Chainable. */
  add(
    ...definitions: ReadonlyArray<GherkinStepDefinition<TContext>>
  ): GherkinStepRegistry<TContext>;
  /** Adds every definition from the given registries. Chainable. */
  merge(...registries: ReadonlyArray<GherkinStepRegistry<TContext>>): GherkinStepRegistry<TContext>;
}

/** Step definitions accepted by the Gherkin importer: a plain array or a registry. */
export type GherkinStepDefinitions<TContext extends object> =
  ReadonlyArray<GherkinStepDefinition<TContext>> | GherkinStepRegistry<TContext>;

export interface GherkinImportOptions<TContext extends object> {
  readonly uri?: string;
  readonly defaultDialect?: string;
  readonly stepDefinitions: GherkinStepDefinitions<TContext>;
  readonly acceptanceTagPrefix?: string;
  readonly acceptanceTagPattern?: RegExp | string;
  readonly acceptanceMetadataPattern?: RegExp | string;
  readonly metadata?: Record<string, unknown>;
  /**
   * Whether generated scenarios with more than one `Given` keyword are split
   * into independently executed sub-scenarios. Defaults to `true` (same as
   * `defineScenario`); pass `false` to keep every scenario linear. Note that
   * `And`/`But` continuation steps never start a new sub-scenario — only
   * explicit repeated `Given` keywords do.
   */
  readonly splitOnGiven?: boolean;
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

interface ScenarioIdentity {
  readonly id: string;
  readonly title: string;
}

/**
 * Derives stable, deterministic scenario ids from the feature and scenario
 * names instead of the parser's per-run random ids. When several pickles
 * share the same name (e.g. a Scenario Outline whose title has no
 * `<placeholder>`, or two scenarios with identical names), every occurrence
 * is disambiguated with its 1-based position: `feature:scenario:2` /
 * `Scenario name #2`.
 */
function createScenarioIdentities(
  feature: Feature,
  pickles: ReadonlyArray<Pickle>,
): ReadonlyArray<ScenarioIdentity> {
  const featureSlug = slugify(feature.name, "scenario");
  const totals = new Map<string, number>();

  for (const pickle of pickles) {
    const baseId = `${featureSlug}:${slugify(pickle.name, "scenario")}`;
    totals.set(baseId, (totals.get(baseId) ?? 0) + 1);
  }

  const occurrences = new Map<string, number>();

  return pickles.map((pickle) => {
    const baseId = `${featureSlug}:${slugify(pickle.name, "scenario")}`;
    const occurrence = (occurrences.get(baseId) ?? 0) + 1;
    occurrences.set(baseId, occurrence);

    if ((totals.get(baseId) ?? 0) <= 1) {
      return { id: baseId, title: pickle.name };
    }

    return {
      id: `${baseId}:${occurrence}`,
      title: `${pickle.name} #${occurrence}`,
    };
  });
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
          pickleStep.argument.dataTable.rows.map((row) =>
            Object.freeze(row.cells.map((cell) => cell.value)),
          ),
        ),
      },
    });
  }

  return Object.keys(argument).length === 0 ? undefined : argument;
}

function toStepDefinitionArray<TContext extends object>(
  stepDefinitions: GherkinStepDefinitions<TContext>,
): ReadonlyArray<GherkinStepDefinition<TContext>> {
  return Array.isArray(stepDefinitions)
    ? stepDefinitions
    : (stepDefinitions as GherkinStepRegistry<TContext>).stepDefinitions;
}

function compileStepDefinitions<TContext extends object>(
  stepDefinitions: GherkinStepDefinitions<TContext>,
): ReadonlyArray<CompiledStepDefinition<TContext>> {
  const parameterTypeRegistry = new ParameterTypeRegistry();

  return toStepDefinitionArray(stepDefinitions).map((definition) => ({
    ...definition,
    compiledExpression: new CucumberExpression(definition.expression, parameterTypeRegistry),
  }));
}

function createGherkinArtifacts(
  featureText: string,
  uri: string,
  defaultDialect?: string,
): GherkinArtifacts {
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

function createPickleSourceLookup(
  gherkinDocument: GherkinDocument,
): ReadonlyMap<string, PickleSourceInfo> {
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
    return args
      ? [{ definition, arguments: args.map((arg) => arg.getValue<unknown>(undefined)) }]
      : [];
  });

  if (matches.length === 0) {
    throw new Error(
      `No Cucumber step definition matched: ${pickleStep.text}\n\nImplement it with:\n\n${generateGherkinStepSnippet(pickleStep.text)}\n`,
    );
  }

  if (matches.length > 1) {
    throw new Error(`Ambiguous Cucumber step definitions matched: ${pickleStep.text}`);
  }

  return matches[0]!;
}

function createScenarioSteps<TContext extends object>(
  scenarioId: string,
  pickle: Pickle,
  sourceInfo: PickleSourceInfo,
  compiledDefinitions: ReadonlyArray<CompiledStepDefinition<TContext>>,
) {
  return pickle.steps.map((pickleStep, index) => {
    const sourceStep = pickleStep.astNodeIds
      .map((astNodeId) => sourceInfo.stepByAstNodeId.get(astNodeId))
      .find((step): step is Step => step !== undefined);
    const { definition, arguments: matchedArguments } = resolveCompiledStep(
      compiledDefinitions,
      pickleStep,
    );
    const argumentData = toStepArgument(pickleStep);
    const keyword = sourceStep?.keyword ?? "";
    const type = toStepType(sourceStep?.keywordType);

    return defineStep<TContext>({
      id: `${scenarioId}:step-${index + 1}`,
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

export function createGherkinStepRegistry<TContext extends object = Record<string, unknown>>(
  initial: ReadonlyArray<GherkinStepDefinition<TContext>> = [],
): GherkinStepRegistry<TContext> {
  const definitions: Array<GherkinStepDefinition<TContext>> = [...initial];

  const registry: GherkinStepRegistry<TContext> = {
    get stepDefinitions() {
      return Object.freeze([...definitions]);
    },
    define(input) {
      definitions.push(defineGherkinStep(input));
      return registry;
    },
    add(...nextDefinitions) {
      definitions.push(...nextDefinitions);
      return registry;
    },
    merge(...registries) {
      for (const other of registries) {
        definitions.push(...other.stepDefinitions);
      }

      return registry;
    },
  };

  return registry;
}

function escapeCucumberExpressionText(value: string): string {
  return value.replace(/[\\/{()]/g, (character) => `\\${character}`);
}

const SNIPPET_PLACEHOLDER_PATTERN = /"[^"]*"|(?<![\w-])-?\d+(?:\.\d+)?(?![\w.])/g;

interface SuggestedExpression {
  readonly expression: string;
  readonly argumentNames: ReadonlyArray<string>;
}

/**
 * Derives a Cucumber expression from a concrete step text: quoted values
 * become `{string}`, whole numbers `{int}`, decimals `{float}`; characters
 * Cucumber expressions treat specially are escaped.
 */
function suggestGherkinExpression(text: string): SuggestedExpression {
  const argumentNames: Array<string> = [];
  const counts: Record<string, number> = {};
  let expression = "";
  let lastIndex = 0;

  for (const match of text.matchAll(SNIPPET_PLACEHOLDER_PATTERN)) {
    const token = match[0];
    const kind = token.startsWith('"') ? "string" : token.includes(".") ? "float" : "int";
    counts[kind] = (counts[kind] ?? 0) + 1;
    argumentNames.push(`${kind}${counts[kind]}`);
    expression += escapeCucumberExpressionText(text.slice(lastIndex, match.index));
    expression += `{${kind}}`;
    lastIndex = match.index + token.length;
  }

  expression += escapeCucumberExpressionText(text.slice(lastIndex));

  return { expression, argumentNames };
}

/**
 * Generates a ready-to-paste `defineGherkinStep()` snippet for a step text
 * that has no matching definition. Used in the "undefined steps" error, and
 * exported for tooling.
 */
export function generateGherkinStepSnippet(text: string): string {
  const { expression, argumentNames } = suggestGherkinExpression(text);
  const escapedExpression = expression.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const destructured = argumentNames.length
    ? `{ arguments: [${argumentNames.join(", ")}], context }`
    : "{ context }";

  return [
    "defineGherkinStep({",
    `  expression: "${escapedExpression}",`,
    `  execute: (${destructured}) => {`,
    '    throw new Error("Step not implemented yet");',
    "  },",
    "});",
  ].join("\n");
}

function collectUndefinedStepTexts<TContext extends object>(
  pickles: ReadonlyArray<Pickle>,
  compiledDefinitions: ReadonlyArray<CompiledStepDefinition<TContext>>,
): ReadonlyArray<string> {
  const unmatched = new Set<string>();

  for (const pickle of pickles) {
    for (const pickleStep of pickle.steps) {
      const hasMatch = compiledDefinitions.some(
        (definition) => definition.compiledExpression.match(pickleStep.text) !== null,
      );

      if (!hasMatch) {
        unmatched.add(pickleStep.text);
      }
    }
  }

  return Object.freeze(Array.from(unmatched));
}

function assertAllStepsDefined<TContext extends object>(
  uri: string,
  pickles: ReadonlyArray<Pickle>,
  compiledDefinitions: ReadonlyArray<CompiledStepDefinition<TContext>>,
): void {
  const undefinedTexts = collectUndefinedStepTexts(pickles, compiledDefinitions);

  if (undefinedTexts.length === 0) {
    return;
  }

  const listing = undefinedTexts.map((text) => `  - ${text}`).join("\n");
  const snippets = undefinedTexts.map((text) => generateGherkinStepSnippet(text)).join("\n\n");

  throw new Error(
    `${undefinedTexts.length} Gherkin step(s) in ${uri} have no matching step definition:\n\n` +
      `${listing}\n\nImplement them with:\n\n${snippets}\n`,
  );
}

export function createGherkinStory<TContext extends object>(
  featureText: string,
  options: GherkinImportOptions<TContext>,
): Story<TContext> {
  const uri = options.uri ?? "feature.feature";
  const { gherkinDocument, pickles } = createGherkinArtifacts(
    featureText,
    uri,
    options.defaultDialect,
  );
  const sourceLookup = createPickleSourceLookup(gherkinDocument);
  const compiledDefinitions = compileStepDefinitions(options.stepDefinitions);
  const feature = gherkinDocument.feature;

  if (!feature) {
    throw new Error(`Unable to parse Gherkin feature from ${uri}`);
  }

  assertAllStepsDefined(uri, pickles, compiledDefinitions);

  const identities = createScenarioIdentities(feature, pickles);

  const scenarios = pickles.map((pickle, pickleIndex) => {
    const identity = identities[pickleIndex]!;
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
      id: identity.id,
      title: identity.title,
      ...(createScenarioDescription(sourceInfo, pickle)
        ? { description: createScenarioDescription(sourceInfo, pickle)! }
        : {}),
      ...(options.splitOnGiven !== undefined ? { splitOnGiven: options.splitOnGiven } : {}),
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
      steps: createScenarioSteps(identity.id, pickle, sourceInfo, compiledDefinitions),
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

export interface GherkinDirectoryImportOptions<TContext extends object> extends Omit<
  GherkinImportOptions<TContext>,
  "uri"
> {
  /** File extensions treated as feature files. Defaults to `[".feature"]`. */
  readonly extensions?: ReadonlyArray<string>;
}

/**
 * Recursively finds feature files under a directory. Results are sorted by
 * full path so the returned order is deterministic across platforms.
 */
export async function findFeatureFiles(
  directory: string,
  extensions: ReadonlyArray<string> = [".feature"],
): Promise<ReadonlyArray<string>> {
  const normalizedExtensions = extensions.map((extension) => extension.toLowerCase());
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });

  return Object.freeze(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          normalizedExtensions.some((extension) => entry.name.toLowerCase().endsWith(extension)),
      )
      .map((entry) => join(entry.parentPath, entry.name))
      .sort(),
  );
}

/**
 * Loads every `.feature` file under a directory (recursively) and returns
 * one story per file. Throws when the directory contains no feature files,
 * so an empty suite never passes silently.
 */
export async function createGherkinStoriesFromDirectory<TContext extends object>(
  directory: string,
  options: GherkinDirectoryImportOptions<TContext>,
): Promise<ReadonlyArray<Story<TContext>>> {
  const { extensions, ...importOptions } = options;
  const files = await findFeatureFiles(directory, extensions);

  if (files.length === 0) {
    throw new Error(`No feature files found under ${directory}`);
  }

  return Promise.all(files.map((filePath) => createGherkinStoryFromFile(filePath, importOptions)));
}
