import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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