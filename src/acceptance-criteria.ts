import type { Scenario } from "./domain.js";
import { createGherkinScenarios, type GherkinImportOptions } from "./gherkin.js";

export type AcceptanceCriteriaContentType = "markdown" | "html";

export interface AcceptanceCriteriaImportOptions<TContext extends object> extends Omit<
  GherkinImportOptions<TContext>,
  "uri"
> {
  readonly uri?: string;
  /** `"html"` or `"markdown"`. Auto-detected from the content when omitted. */
  readonly contentType?: AcceptanceCriteriaContentType;
  /** Feature title for the synthetic Gherkin document the default parser builds. Defaults to `"Acceptance criteria"`. */
  readonly title?: string;
  /**
   * DevOps work item id (or any external id). Tags every generated scenario
   * with `@<workItemId>` so it flows through the existing Gherkin
   * acceptance-tag extraction (`acceptanceTagPrefix` / `acceptanceTagPattern`)
   * for free — no separate acceptance-id mechanism.
   */
  readonly workItemId?: string | number;
  /**
   * Overrides how normalized acceptance-criteria text becomes scenario(s).
   * Receives the content already normalized to plain text (HTML and
   * Markdown converge on the same shape before this runs) plus the import
   * options; may return a single scenario or a list — both are accepted and
   * normalized to a list by `createScenariosFromAcceptanceCriteria`.
   * Defaults to a Given/When/Then parser that reuses the Gherkin importer.
   */
  readonly parser?: AcceptanceCriteriaParser<TContext>;
}

export type AcceptanceCriteriaParser<TContext extends object> = (
  normalizedText: string,
  options: AcceptanceCriteriaImportOptions<TContext>,
) => Scenario<TContext> | ReadonlyArray<Scenario<TContext>>;

const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/i;

function detectContentType(content: string): AcceptanceCriteriaContentType {
  return HTML_TAG_PATTERN.test(content) ? "html" : "markdown";
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&[a-z#0-9]+;/gi, (entity) => {
    const named = HTML_ENTITIES[entity.toLowerCase()];

    if (named !== undefined) {
      return named;
    }

    const numeric = entity.match(/^&#(x?)([0-9a-f]+);$/i);

    if (numeric) {
      const codePoint = Number.parseInt(numeric[2]!, numeric[1] ? 16 : 10);
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }

    return entity;
  });
}

/**
 * Rich-text editors (Azure DevOps included) silently replace typed
 * characters: straight quotes become curly, spaces become non-breaking.
 * Both are invisible in an "undefined step" listing yet break Cucumber
 * expression matching, so they are normalized back before parsing.
 *
 * The first character class is not blank: it contains the literal characters
 * U+00A0 (no-break space), U+2007 (figure space), and U+202F (narrow
 * no-break space).
 */
function normalizeTypography(text: string): string {
  return text
    .replace(/[   ]/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}

/**
 * ponytail: a regex-based HTML-to-text pass, not a full HTML parser — it
 * only handles the block/list/emphasis tags Azure DevOps' rich-text editor
 * actually emits for an Acceptance Criteria field. Swap in a real HTML
 * parser if acceptance criteria start arriving with more exotic markup
 * (tables, nested lists with mixed markers).
 */
function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/li>/gi, "")
      .replace(/<\/(p|div|h[1-6]|ul|ol)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<(strong|em|b|i|span)[^>]*>/gi, "")
      .replace(/<\/(strong|em|b|i|span)>/gi, "")
      .replace(/<[^>]+>/g, ""),
  );
}

function normalizeMarkdownBullets(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^(\s*)(?:[*+]|\d+[.)])\s+/, "$1- "))
    .join("\n");
}

function collapseBlankLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

/**
 * Normalizes acceptance-criteria content down to the same plain-text shape
 * regardless of source format: Azure DevOps stores the Acceptance Criteria
 * field as HTML, but teams also paste plain Markdown directly. Both are
 * parsed identically once normalized.
 */
export function normalizeAcceptanceCriteriaContent(
  content: string,
  contentType?: AcceptanceCriteriaContentType,
): string {
  const type = contentType ?? detectContentType(content);
  const plainText = type === "html" ? stripHtml(content) : normalizeMarkdownBullets(content);
  return collapseBlankLines(normalizeTypography(plainText));
}

const STEP_LINE_PATTERN = /^-?\s*(Given|When|Then|And|But)\b[:\s]+(.*)$/i;
const SCENARIO_TITLE_PATTERN = /^-?\s*(?:\*\*)?Scenario:?\s*(.*?)(?:\*\*)?$/i;

interface ParsedScenarioBlock {
  readonly title?: string;
  readonly stepLines: ReadonlyArray<string>;
}

interface ScenarioBlockDraft {
  title?: string;
  stepLines: Array<string>;
  hasGiven: boolean;
}

/**
 * Splits normalized acceptance-criteria text into scenario blocks: an
 * explicit `Scenario: <title>` line starts a new block, and (absent one) a
 * repeated `Given` also starts a new block — the same "more than one Given
 * splits the scenario" convention `defineScenario` itself uses. Free-form
 * prose lines that are neither a title nor a step are ignored.
 */
function splitIntoScenarioBlocks(text: string): ReadonlyArray<ParsedScenarioBlock> {
  const blocks: Array<ScenarioBlockDraft> = [];
  let current: ScenarioBlockDraft | undefined;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const titleMatch = line.match(SCENARIO_TITLE_PATTERN);

    if (titleMatch) {
      const title = titleMatch[1]?.trim();
      current = title
        ? { title, stepLines: [], hasGiven: false }
        : { stepLines: [], hasGiven: false };
      blocks.push(current);
      continue;
    }

    const stepMatch = line.match(STEP_LINE_PATTERN);

    if (!stepMatch) {
      continue;
    }

    const isGiven = stepMatch[1]!.toLowerCase() === "given";
    const isNewGiven = isGiven && current !== undefined && current.hasGiven;

    if (!current || isNewGiven) {
      current = { stepLines: [], hasGiven: false };
      blocks.push(current);
    }

    current.hasGiven = current.hasGiven || isGiven;
    current.stepLines.push(line);
  }

  return Object.freeze(blocks.filter((block) => block.stepLines.length > 0));
}

function toGherkinStepLine(line: string): string {
  const match = line.match(STEP_LINE_PATTERN)!;
  const keyword = match[1]!;
  const titleCaseKeyword = keyword[0]!.toUpperCase() + keyword.slice(1).toLowerCase();
  return `    ${titleCaseKeyword} ${match[2]!.trim()}`;
}

function toGherkinFeatureText(
  blocks: ReadonlyArray<ParsedScenarioBlock>,
  featureTitle: string,
  tag?: string,
): string {
  const scenarios = blocks.map((block, index) => {
    const title = block.title ?? `Acceptance criteria ${index + 1}`;
    const tagLine = tag ? `  @${tag}\n` : "";
    const steps = block.stepLines.map(toGherkinStepLine).join("\n");

    return `${tagLine}  Scenario: ${title}\n${steps}`;
  });

  return `Feature: ${featureTitle}\n\n${scenarios.join("\n\n")}\n`;
}

/**
 * Default acceptance-criteria parser: reads Given/When/Then bullet lines
 * (optionally grouped under `Scenario: <title>` headings), synthesizes a
 * Gherkin feature from them, and delegates to `createGherkinScenarios` —
 * generated scenarios get the exact same step-matching, tagging, and
 * sub-scenario-splitting behavior as scenarios imported from `.feature`
 * files.
 */
export function defaultAcceptanceCriteriaParser<TContext extends object>(
  normalizedText: string,
  options: AcceptanceCriteriaImportOptions<TContext>,
): ReadonlyArray<Scenario<TContext>> {
  const blocks = splitIntoScenarioBlocks(normalizedText);

  if (blocks.length === 0) {
    throw new Error("No Given/When/Then steps found in the acceptance criteria content.");
  }

  const featureTitle = options.title ?? "Acceptance criteria";
  const tag = options.workItemId !== undefined ? String(options.workItemId) : undefined;
  const featureText = toGherkinFeatureText(blocks, featureTitle, tag);

  return createGherkinScenarios(featureText, {
    ...options,
    uri: options.uri ?? "acceptance-criteria.feature",
  });
}

/**
 * Imports scenario(s) from an acceptance-criteria field (as stored by
 * Azure DevOps or similar tools). Content may be HTML or Markdown — both are
 * normalized to the same plain text before parsing (see
 * `normalizeAcceptanceCriteriaContent`). Pass `parser` to fully customize how
 * that text becomes scenarios (e.g. for teams that don't write Given/When/Then);
 * the parser may return a single `Scenario` or a list, both are normalized to
 * a list here.
 */
export function createScenariosFromAcceptanceCriteria<TContext extends object>(
  content: string,
  options: AcceptanceCriteriaImportOptions<TContext>,
): ReadonlyArray<Scenario<TContext>> {
  const normalized = normalizeAcceptanceCriteriaContent(content, options.contentType);
  const parse = options.parser ?? defaultAcceptanceCriteriaParser;
  const result = parse(normalized, options);

  return Object.freeze(Array.isArray(result) ? [...result] : [result]);
}
