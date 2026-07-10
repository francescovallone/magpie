#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { partitionMagpieArgv, toMagpieEnv } from "./cli.js";

const HELP_TEXT = `magpie — run Vitest with Magpie filter flags, no "--" passthrough needed.

Usage:
  magpie [vitest args] [magpie flags]

Magpie flags (converted to MAGPIE_* environment variables):
  --tag <tag>              filter by scenario tag (repeatable, csv allowed)
  --acceptance <id>        filter by acceptance id (glob * supported)
  --story <title>          filter by story title
  --scenario <title>       filter by scenario title
  --regex, --grep <text>   match id, title, description, tags, acceptance, story
  --output <kind>          enable report outputs (e.g. html, json)

Everything else is forwarded to Vitest unchanged:
  magpie run --tag auth
  magpie run --coverage --acceptance "AUTH-*"
  magpie watch --story Authentication

Use "magpie --help-vitest" (or "magpie run --help") for Vitest's own help.
`;

function resolveVitestEntry(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("vitest/package.json", { paths: [process.cwd()] });
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const bin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.["vitest"];

  if (!bin) {
    throw new Error("vitest package has no bin entry");
  }

  return join(dirname(packageJsonPath), bin);
}

function main(): void {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  const { magpieArgv, forwardedArgv } = partitionMagpieArgv(
    argv.map((argument) => (argument === "--help-vitest" ? "--help" : argument)),
  );
  const env = { ...process.env, ...toMagpieEnv(magpieArgv) };

  let vitestEntry: string;
  try {
    vitestEntry = resolveVitestEntry();
  } catch {
    process.stderr.write(
      "magpie: could not resolve vitest — install it first: npm install --save-dev vitest\n",
    );
    process.exitCode = 1;
    return;
  }

  const child = spawn(process.execPath, [vitestEntry, ...forwardedArgv], {
    env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exitCode = code ?? 1;
  });

  child.on("error", (error) => {
    process.stderr.write(`magpie: failed to start vitest: ${error.message}\n`);
    process.exitCode = 1;
  });
}

main();
