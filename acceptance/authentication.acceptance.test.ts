import { defineAcceptanceScenario, defineStory, registerFilteredStory, resolveScenarioFilter } from "../src/index.js";

type AuthContext = {
  response?: { status: number; token?: string };
  registered?: boolean;
};

const registeredUserLogsIn = defineAcceptanceScenario<AuthContext>({
  id: "auth-acceptance-1",
  title: "Registered user logs in",
  acceptance: ["AUTH-001"],
  tags: ["auth", "critical"],
  story: { title: "Authentication" },
  steps: [
    {
      id: "given-registered-user",
      name: "registered user exists",
      type: "given",
      execute: (context) => {
        context.registered = true;
      },
    },
    {
      id: "when-submit-credentials",
      name: "credentials are submitted",
      type: "when",
      execute: (context) => {
        context.response = { status: 200, token: "token-123" };
      },
    },
    {
      id: "then-token-returned",
      name: "token is returned",
      type: "then",
      execute: (context) => {
        if (context.response?.status !== 200 || !context.response.token) {
          throw new Error("Expected successful authentication");
        }
      },
    },
  ],
});

const lockedUserIsRejected = defineAcceptanceScenario<AuthContext>({
  id: "auth-acceptance-2",
  title: "Locked user is rejected",
  acceptance: ["AUTH-002"],
  tags: ["auth", "security"],
  story: { title: "Authentication" },
  steps: [
    {
      id: "when-submit-locked-user",
      name: "locked user submits credentials",
      type: "when",
      execute: (context) => {
        context.response = { status: 403 };
      },
    },
    {
      id: "then-access-denied",
      name: "access is denied",
      type: "then",
      execute: (context) => {
        if (context.response?.status !== 403) {
          throw new Error("Expected a forbidden response");
        }
      },
    },
  ],
});

const authenticationStory = defineStory<AuthContext>({
  title: "Authentication",
  scenarios: [registeredUserLogsIn, lockedUserIsRejected],
});

registerFilteredStory(authenticationStory, {
  filter: resolveScenarioFilter({
    argv: process.argv.slice(2),
    env: process.env,
  }),
  reportToVitest: true,
});