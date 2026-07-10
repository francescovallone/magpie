import { describe, expect, it } from "vitest";

import { defineAcceptanceScenario, executeScenario, scenario } from "../src/index.js";

describe("step and scenario id derivation", () => {
  it("derives step ids from names when omitted", () => {
    const checkout = defineAcceptanceScenario<{ paid?: boolean }>({
      id: "checkout",
      title: "Customer checks out",
      steps: [
        {
          name: "a cart with two items",
          type: "given",
          execute: () => undefined,
        },
        {
          name: "the customer pays",
          type: "when",
          execute: (context) => {
            context.paid = true;
          },
        },
      ],
    });

    expect(checkout.steps.map((step) => step.id)).toEqual([
      "a-cart-with-two-items",
      "the-customer-pays",
    ]);
  });

  it("disambiguates duplicate derived step ids with their occurrence", () => {
    const flows = defineAcceptanceScenario({
      id: "flows",
      title: "Repeated step names",
      steps: [
        { name: "customer pays", type: "when", execute: () => undefined },
        { name: "customer pays", type: "when", execute: () => undefined },
        { name: "receipt is produced", type: "then", execute: () => undefined },
      ],
    });

    expect(flows.steps.map((step) => step.id)).toEqual([
      "customer-pays-1",
      "customer-pays-2",
      "receipt-is-produced",
    ]);
  });

  it("derives the scenario id from the title when omitted", () => {
    const login = defineAcceptanceScenario({
      title: "Registered user logs in",
      steps: [{ name: "noop", type: "given", execute: () => undefined }],
    });

    expect(login.id).toBe("registered-user-logs-in");
  });
});

describe("builder shorthand", () => {
  it("accepts (name, execute) pairs on every step method", async () => {
    const login = scenario<{ response?: { status: number } }>("Registered user logs in")
      .acceptance("AUTH-001")
      .given("registered user exists", () => undefined)
      .when("credentials are submitted", (context) => {
        context.response = { status: 200 };
      })
      .then("a success status is returned", (context) => {
        if (context.response?.status !== 200) {
          throw new Error("Expected 200");
        }
      })
      .build();

    expect(login.id).toBe("registered-user-logs-in");
    expect(login.steps.map((step) => step.id)).toEqual([
      "registered-user-exists",
      "credentials-are-submitted",
      "a-success-status-is-returned",
    ]);

    const result = await executeScenario(login);
    expect(result.success).toBe(true);
  });

  it("supports given options in shorthand form for sub-scenario acceptance ids", () => {
    const checkout = scenario("checkout", "Checkout flows")
      .acceptance("AC-001")
      .given("valid card", () => undefined)
      .when("customer pays", () => undefined)
      .given("expired card", () => undefined, { acceptance: "AC-001-EXPIRED" })
      .when("customer pays again", () => undefined)
      .build();

    expect(checkout.subScenarios).toHaveLength(2);
    expect(checkout.subScenarios?.[0]?.acceptance).toEqual(["AC-001-01"]);
    expect(checkout.subScenarios?.[1]?.acceptance).toEqual(["AC-001-EXPIRED"]);
  });

  it("still accepts the object form with an explicit id", () => {
    const built = scenario("explicit", "Explicit ids")
      .given({ id: "given-user", name: "user exists", execute: () => undefined })
      .build();

    expect(built.steps[0]?.id).toBe("given-user");
  });

  it("throws when the shorthand is missing its execute function", () => {
    const builder = scenario("broken", "Broken");
    expect(() => (builder.given as unknown as (name: string) => unknown)("no executor")).toThrowError(
      /missing its execute function/,
    );
  });

  it("cleanup shorthand keeps the cleanup lifecycle", () => {
    const built = scenario("cleanup", "Cleanup lifecycle")
      .given("db is seeded", () => undefined)
      .cleanup("db is wiped", () => undefined)
      .build();

    expect(built.steps.at(-1)?.lifecycle).toBe("cleanup");
  });
});
