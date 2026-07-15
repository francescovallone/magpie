import {
  createGherkinStory,
  defineGherkinStep,
  registerFilteredStory,
  resolveScenarioFilter,
} from "../src/index.js";

type CartContext = {
  items?: Array<{ price: number; quantity: number }>;
  total?: number;
};

const story = createGherkinStory<CartContext>(
  `
Feature: Shopping cart

  @cart @CART-001
  Scenario: Checkout totals the cart
    Given an empty cart
    When 2 items priced at 10 are added
    And the cart is checked out
    Then the total charged is 20

  @cart @CART-002
  Scenario Outline: Checkout totals vary with quantity and price
    Given an empty cart
    When <quantity> items priced at <price> are added
    And the cart is checked out
    Then the total charged is <total>

    Examples:
      | quantity | price | total |
      | 1        | 5     | 5     |
      | 3        | 4     | 12    |
`,
  {
    uri: "shopping-cart.feature",
    stepDefinitions: [
      defineGherkinStep({
        expression: "an empty cart",
        execute: ({ context }) => {
          context.items = [];
        },
      }),
      defineGherkinStep({
        expression: "{int} items priced at {int} are added",
        execute: ({ arguments: [quantity, price], context }) => {
          context.items!.push({ quantity: quantity as number, price: price as number });
        },
      }),
      defineGherkinStep({
        expression: "the cart is checked out",
        execute: ({ context }) => {
          context.total = (context.items ?? []).reduce(
            (sum, item) => sum + item.price * item.quantity,
            0,
          );
        },
      }),
      defineGherkinStep({
        expression: "the total charged is {int}",
        execute: ({ arguments: [expected], context }) => {
          if (context.total !== expected) {
            throw new Error(`Expected total ${expected} but got ${context.total}`);
          }
        },
      }),
    ],
  },
);

registerFilteredStory(story, {
  filter: resolveScenarioFilter({ argv: process.argv.slice(2), env: process.env }),
  reportToVitest: true,
});
