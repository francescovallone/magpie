import { describe, expect, it } from "vitest";

import { partitionMagpieArgv, toMagpieEnv } from "../src/index.js";

describe("partitionMagpieArgv", () => {
  it("separates magpie flags from vitest arguments", () => {
    const { magpieArgv, forwardedArgv } = partitionMagpieArgv([
      "run",
      "--coverage",
      "--tag",
      "auth",
      "--acceptance=AUTH-*",
      "tests/login.test.ts",
      "--grep",
      "critical",
    ]);

    expect(magpieArgv).toEqual(["--tag", "auth", "--acceptance=AUTH-*", "--grep", "critical"]);
    expect(forwardedArgv).toEqual(["run", "--coverage", "tests/login.test.ts"]);
  });

  it("passes everything through when no magpie flags are present", () => {
    const { magpieArgv, forwardedArgv } = partitionMagpieArgv(["run", "--reporter", "dot"]);

    expect(magpieArgv).toEqual([]);
    expect(forwardedArgv).toEqual(["run", "--reporter", "dot"]);
  });
});

describe("toMagpieEnv", () => {
  it("converts flags into MAGPIE_* environment variables", () => {
    const env = toMagpieEnv([
      "--tag",
      "auth,critical",
      "--acceptance",
      "AUTH-*",
      "--story",
      "Authentication",
      "--scenario",
      "Registered user logs in",
      "--regex",
      "critical",
      "--output",
      "html",
    ]);

    expect(env).toEqual({
      MAGPIE_TAGS: "auth,critical",
      MAGPIE_ACCEPTANCE: "AUTH-*",
      MAGPIE_STORY: "Authentication",
      MAGPIE_SCENARIO: "Registered user logs in",
      MAGPIE_REGEX: "critical",
      MAGPIE_OUTPUT: "html",
    });
  });

  it("returns an empty object when nothing matches", () => {
    expect(toMagpieEnv(["run", "--coverage"])).toEqual({});
  });

  it("honors a custom env prefix", () => {
    expect(toMagpieEnv(["--tag", "auth"], "ACCEPT")).toEqual({ ACCEPT_TAGS: "auth" });
  });
});
