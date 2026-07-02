import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonReportWriteOptions {
  readonly spacing?: number;
}

export async function writeJsonReport(
  outputPath: string,
  report: unknown,
  options: JsonReportWriteOptions = {},
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const spacing = options.spacing ?? 2;
  const content = `${JSON.stringify(report, null, spacing)}\n`;

  await writeFile(outputPath, content, "utf8");
}