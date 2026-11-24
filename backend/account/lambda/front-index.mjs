// Lambda entry of the account API's front (infra/aws/account.yaml, function
// vega-v2-account-front): outside the VPC, behind its Function URL. Its settings come from the
// stack's environment; without them every request answers 503 NOT_CONFIGURED (src/front.mjs).
// The AWS SDK that invokes the store is the Node.js runtime's own, loaded on the first call.
import { createFrontFromEnv } from "../src/front.mjs";

export const handler = createFrontFromEnv(process.env, { log: console.log });
