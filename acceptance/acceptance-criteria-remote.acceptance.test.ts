import {
  createScenariosFromAcceptanceCriteria,
  defineGherkinStep,
  defineStory,
  registerFilteredStory,
  resolveScenarioFilter,
} from "../src/index.js";

type CheckoutContext = {
  cart?: { items: number };
  charged?: boolean;
};

/**
 * Stands in for `await fetch(\`https://dev.azure.com/{org}/{project}/_apis/wit/workitems/${workItemId}\`)`
 * followed by reading `.fields["Microsoft.VSTS.Common.AcceptanceCriteria"]`
 * — the HTML Azure DevOps stores for a work item's Acceptance Criteria
 * field. Swapped for a real HTTP call against your DevOps/Jira instance.
 */
async function fetchAcceptanceCriteriaFromDevOps(workItemId: number): Promise<string> {
  const workItems: Record<number, string> = {
    4321: `
      <p><strong>Scenario: Successful checkout</strong></p>
      <ul>
        <li>Given items are in the cart</li>
        <li>When the customer checks out</li>
        <li>Then the payment is charged</li>
      </ul>
    `,
  };

  const html = workItems[workItemId];

  if (!html) {
    throw new Error(`No work item found for id ${workItemId}`);
  }

  return html;
}

const acceptanceCriteria = await fetchAcceptanceCriteriaFromDevOps(4321);

const scenarios = createScenariosFromAcceptanceCriteria<CheckoutContext>(acceptanceCriteria, {
  title: "Checkout",
  workItemId: 4321,
  stepDefinitions: [
    defineGherkinStep({
      expression: "items are in the cart",
      execute: ({ context }) => {
        context.cart = { items: 1 };
      },
    }),
    defineGherkinStep({
      expression: "the customer checks out",
      execute: ({ context }) => {
        context.charged = (context.cart?.items ?? 0) > 0;
      },
    }),
    defineGherkinStep({
      expression: "the payment is charged",
      execute: ({ context }) => {
        if (!context.charged) {
          throw new Error("Expected the payment to be charged");
        }
      },
    }),
  ],
});

const story = defineStory({ title: "Checkout", scenarios });

registerFilteredStory(story, {
  filter: resolveScenarioFilter({ argv: process.argv.slice(2), env: process.env }),
  reportToVitest: true,
});
