import { describe, expect, it } from "vitest";

import {
  createPlaywrightHooks,
  executeScenario,
  scenario,
  type PlaywrightBrowser,
  type PlaywrightBrowserContext,
  type PlaywrightPage,
  type PlaywrightScenarioContext,
} from "../src/index.js";

function createFakeBrowser() {
  const calls: Array<string> = [];
  const screenshot = new Uint8Array([1, 2, 3]);

  const browser: PlaywrightBrowser = {
    async newContext() {
      calls.push("newContext");

      const page: PlaywrightPage = {
        async screenshot() {
          calls.push("screenshot");
          return screenshot;
        },
        async close() {
          calls.push("page.close");
        },
      };

      const browserContext: PlaywrightBrowserContext = {
        async newPage() {
          calls.push("newPage");
          return page;
        },
        async close() {
          calls.push("context.close");
        },
      };

      return browserContext;
    },
    async close() {
      calls.push("browser.close");
    },
  };

  return { browser, calls, screenshot };
}

describe("createPlaywrightHooks", () => {
  it("creates a page per scenario and closes the context afterwards", async () => {
    const { browser, calls } = createFakeBrowser();
    const hooks = createPlaywrightHooks<PlaywrightScenarioContext>({ launch: () => browser });

    const passing = scenario<PlaywrightScenarioContext>("page is available")
      .given("a page exists", (context) => {
        if (!context.page) throw new Error("page not set");
      })
      .build();

    const result = await executeScenario(passing, { hooks, createContext: () => ({}) });

    expect(result.success).toBe(true);
    expect(calls).toEqual(["newContext", "newPage", "context.close"]);

    await hooks.close();
    expect(calls).toContain("browser.close");
  });

  it("launches the browser once across scenarios", async () => {
    const { browser, calls } = createFakeBrowser();
    let launches = 0;
    const hooks = createPlaywrightHooks<PlaywrightScenarioContext>({
      launch: () => {
        launches += 1;
        return browser;
      },
    });

    const noop = scenario<PlaywrightScenarioContext>("noop")
      .given("nothing", () => undefined)
      .build();

    await executeScenario(noop, { hooks, createContext: () => ({}) });
    await executeScenario(noop, { hooks, createContext: () => ({}) });

    expect(launches).toBe(1);
    expect(calls.filter((call) => call === "newContext")).toHaveLength(2);
    await hooks.close();
  });

  it("attaches a failure screenshot to the failed step", async () => {
    const { browser, screenshot } = createFakeBrowser();
    const hooks = createPlaywrightHooks<PlaywrightScenarioContext>({ launch: () => browser });

    const failing = scenario<PlaywrightScenarioContext>("failing scenario")
      .given({ id: "given-boom", name: "it explodes", execute: () => undefined })
      .then({
        id: "then-boom",
        name: "it explodes",
        execute: () => {
          throw new Error("boom");
        },
      })
      .build();

    const result = await executeScenario(failing, { hooks, createContext: () => ({}) });
    await hooks.close();

    expect(result.success).toBe(false);
    const attachment = result.attachments.find((entry) => entry.contentType === "image/png");
    expect(attachment).toBeDefined();
    expect(attachment?.body).toBe(screenshot);
    expect(attachment?.stepId).toBe("then-boom");

    const failedStep = result.steps.find((step) => step.status === "failed");
    expect(failedStep?.attachments).toContainEqual(attachment);
  });

  it("skips the screenshot when disabled", async () => {
    const { browser, calls } = createFakeBrowser();
    const hooks = createPlaywrightHooks<PlaywrightScenarioContext>({
      launch: () => browser,
      screenshotOnFailure: false,
    });

    const failing = scenario<PlaywrightScenarioContext>("failing scenario")
      .then("it explodes", () => {
        throw new Error("boom");
      })
      .build();

    const result = await executeScenario(failing, { hooks, createContext: () => ({}) });
    await hooks.close();

    expect(result.success).toBe(false);
    expect(calls).not.toContain("screenshot");
    expect(result.attachments.filter((entry) => entry.contentType === "image/png")).toHaveLength(0);
  });
});
