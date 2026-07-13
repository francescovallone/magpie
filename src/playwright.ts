import type { ExecutionAttachment, ExecutionHooks } from "./engine.js";

/**
 * Structural subsets of Playwright's `Browser`/`BrowserContext`/`Page` — the
 * real objects are assignable, and Magpie needs no dependency on Playwright.
 */
export interface PlaywrightPage {
  screenshot(options?: { fullPage?: boolean }): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface PlaywrightBrowserContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

export interface PlaywrightBrowser {
  newContext(options?: Record<string, unknown>): Promise<PlaywrightBrowserContext>;
  close(): Promise<void>;
}

/** Include this in your scenario context type; the hooks fill it per scenario. */
export interface PlaywrightScenarioContext {
  browser?: PlaywrightBrowser;
  browserContext?: PlaywrightBrowserContext;
  page?: PlaywrightPage;
}

export interface CreatePlaywrightHooksOptions {
  /**
   * Launches (or returns) the browser, e.g. `() => chromium.launch()`.
   * Called once, lazily, before the first scenario; the browser is shared
   * across scenarios (each scenario gets its own browser context and page).
   */
  launch: () => Promise<PlaywrightBrowser> | PlaywrightBrowser;
  /** Passed to `browser.newContext()` for every scenario. */
  contextOptions?: Record<string, unknown>;
  /**
   * Attach a full-page screenshot to the failing step when a scenario fails.
   * Defaults to `true`. Screenshots reach reports when the reporter has
   * `attachments: { enabled: true }`.
   */
  screenshotOnFailure?: boolean;
}

export interface PlaywrightHooks<
  TContext extends PlaywrightScenarioContext,
> extends ExecutionHooks<TContext> {
  /** Closes the shared browser. Call once after all scenarios have run. */
  close(): Promise<void>;
}

/**
 * Execution hooks that manage a Playwright page per scenario: a fresh browser
 * context and page are created in `beforeScenario` and closed in
 * `afterScenario`, with an optional failure screenshot attached to the failed
 * step. Combine with other hooks via `mergeExecutionHooks(playwrightHooks,
 * reportingHooks)` — Playwright hooks first, so the screenshot is captured
 * before reporters record the result.
 */
export function createPlaywrightHooks<TContext extends PlaywrightScenarioContext>(
  options: CreatePlaywrightHooksOptions,
): PlaywrightHooks<TContext> {
  let browserPromise: Promise<PlaywrightBrowser> | undefined;

  const getBrowser = () => (browserPromise ??= Promise.resolve(options.launch()));

  return {
    async beforeScenario(_scenario, context) {
      const browser = await getBrowser();
      const browserContext = await browser.newContext(options.contextOptions);
      context.browser = browser;
      context.browserContext = browserContext;
      context.page = await browserContext.newPage();
    },
    async afterScenario(scenario, context, result) {
      if (!result.success && context.page && options.screenshotOnFailure !== false) {
        try {
          const body = await context.page.screenshot({ fullPage: true });
          const failedStep = result.steps.find((step) => step.status === "failed");
          const attachment: ExecutionAttachment = {
            timestamp: Date.now(),
            name: `${scenario.id}-failure.png`,
            contentType: "image/png",
            ...(failedStep ? { stepId: failedStep.stepId } : {}),
            body,
          };

          // The engine's result arrays are readonly-typed but still mutable
          // here: afterScenario runs before the result is handed to reporters.
          (result.attachments as Array<ExecutionAttachment>).push(attachment);
          if (failedStep) {
            (failedStep.attachments as Array<ExecutionAttachment>).push(attachment);
          }
        } catch {
          // Page already closed or crashed — the scenario failure stands on its own.
        }
      }

      await context.browserContext?.close();
      delete context.page;
      delete context.browserContext;
    },
    async close() {
      if (browserPromise) {
        const browser = await browserPromise;
        browserPromise = undefined;
        await browser.close();
      }
    },
  };
}
