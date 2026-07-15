import {
  createPlaywrightHooks,
  defineStory,
  registerStory,
  scenario,
  type PlaywrightBrowser,
  type PlaywrightBrowserContext,
  type PlaywrightPage,
  type PlaywrightScenarioContext,
} from "../src/index.js";

/**
 * Magpie has no dependency on Playwright — `createPlaywrightHooks` only
 * needs an object shaped like a Playwright `Browser`/`Page`. This fake
 * stands in for `chromium.launch()` so the example runs without the real
 * package; swap it (and the extra `goto`/`isVisible` methods below) for
 * `import { chromium } from "playwright"` in a real suite.
 */
interface FakePage extends PlaywrightPage {
  goto(url: string): Promise<void>;
  isVisible(selector: string): Promise<boolean>;
}

interface LoginContext extends PlaywrightScenarioContext {
  page?: FakePage;
}

function createFakeBrowser(): PlaywrightBrowser {
  const knownSelectors = new Set(["form#login"]);
  let currentUrl: string | undefined;

  const page: FakePage = {
    async goto(url) {
      currentUrl = url;
    },
    async isVisible(selector) {
      return currentUrl === "https://example.test/login" && knownSelectors.has(selector);
    },
    async screenshot() {
      return new Uint8Array();
    },
    async close() {},
  };

  const browserContext: PlaywrightBrowserContext = {
    async newPage() {
      return page;
    },
    async close() {},
  };

  return {
    async newContext() {
      return browserContext;
    },
    async close() {},
  };
}

const playwright = createPlaywrightHooks<LoginContext>({ launch: () => createFakeBrowser() });

const login = scenario<LoginContext>("Registered user logs in")
  .acceptance("LOGIN-UI-001")
  .given("the login page is open", async ({ page }) => {
    await page!.goto("https://example.test/login");
  })
  .then("the login form is visible", async ({ page }) => {
    if (!(await page!.isVisible("form#login"))) {
      throw new Error("Expected the login form to be visible");
    }
  })
  .build();

registerStory(defineStory({ title: "Authentication UI", scenarios: [login] }), {
  hooks: playwright,
  reportToVitest: { attachments: { enabled: true } },
});
