import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";

export interface JsonReportWriteOptions {
  readonly spacing?: number;
}

export async function writeTextFile(outputPath: string, content: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf8");
}

export async function writeJsonReport(
  outputPath: string,
  report: unknown,
  options: JsonReportWriteOptions = {},
): Promise<void> {
  const spacing = options.spacing ?? 2;
  const content = `${JSON.stringify(report, null, spacing)}\n`;

  await writeTextFile(outputPath, content);
}

const CSV_HEADER_WORDS = new Set(["id", "ids", "key", "acceptance", "acceptanceid", "issue key"]);

/**
 * Loads the list of expected acceptance ids for traceability from a `.json`
 * file (a bare `["AUTH-001", ...]` array) or a `.csv`/text export (one id
 * per line, first column used if the line has commas; a lone header cell
 * like "id"/"key" is skipped). For a full Jira/Azure Boards export, keep
 * just the id column before feeding it here.
 */
export async function loadAcceptanceIds(filePath: string): Promise<ReadonlyArray<string>> {
  const content = await readFile(filePath, "utf8");

  if (extname(filePath).toLowerCase() === ".json") {
    const parsed = JSON.parse(content) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error(`${filePath} must contain a JSON array of acceptance ids`);
    }

    return Object.freeze(parsed.map(String));
  }

  return Object.freeze(
    content
      .split(/\r?\n/)
      .map((line) => line.split(",", 1)[0]?.trim().replace(/^"|"$/g, "") ?? "")
      .filter((id) => id.length > 0 && !CSV_HEADER_WORDS.has(id.toLowerCase())),
  );
}