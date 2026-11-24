/**
 * The seam between the front and the store. The front calls `store.call(command, fields)`; the
 * command crosses as JSON text through `invoke(text) -> text`, which is the Lambda Invoke API in
 * production (`lambdaInvoker`) and an in-process call of the same store handler in tests
 * (`localInvoker`). Everything above `invoke` is one code path. Failure modes: FAILURE_MODES.md,
 * D11 and D12.
 */

/** The largest payload of a synchronous Lambda invocation, each way. */
export const MAX_PAYLOAD = 6 * 1024 * 1024;

/** The store refused the command (`code`: ACCOUNT_ERASED, CONTRACT_LIMIT, ...). */
export class StoreRefusal extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}
/** The store could not be reached or failed; no detail of the failure is carried. */
export class StoreUnavailable extends Error {
  constructor(cause) {
    super("the account store is unavailable");
    if (cause !== undefined) Object.defineProperty(this, "cause", { value: cause, enumerable: false });
  }
}

export function createStoreClient(invoke) {
  return {
    async call(command, fields = {}) {
      const payload = JSON.stringify({ command, ...fields });
      if (Buffer.byteLength(payload) > MAX_PAYLOAD) throw new StoreRefusal("PAYLOAD_TOO_LARGE", "the command exceeds a Lambda payload");
      let text;
      try {
        text = await invoke(payload);
      } catch (error) {
        throw new StoreUnavailable(error);
      }
      if (typeof text !== "string" || Buffer.byteLength(text) > MAX_PAYLOAD) throw new StoreUnavailable();
      let answer;
      try {
        answer = JSON.parse(text);
      } catch (error) {
        throw new StoreUnavailable(error);
      }
      if (answer?.ok === true) return answer.value ?? null;
      if (answer?.ok === false && typeof answer.code === "string") throw new StoreRefusal(answer.code, answer.message);
      throw new StoreUnavailable();
    },
  };
}

/** Tests: the store handler called in-process, the command and the answer as JSON text both ways. */
export function localInvoker(handle) {
  return async (payload) => JSON.stringify(await handle(JSON.parse(payload)));
}

let sdk;
/** The AWS SDK of the Node.js runtime, loaded on the first call (the offline check needs none). */
async function defaultSend(input) {
  if (!sdk) {
    const lambda = await import("@aws-sdk/client-lambda");
    sdk = { client: new lambda.LambdaClient({}), InvokeCommand: lambda.InvokeCommand };
  }
  return sdk.client.send(new sdk.InvokeCommand(input));
}

/**
 * Production: a synchronous invocation of the store function. `send(input)` is the SDK client's
 * (injected by tests). A function error, a throttle (TooManyRequestsException at the store's
 * reserved copies) or a network fault throws, and the client turns it into StoreUnavailable.
 */
export function lambdaInvoker({ functionName, send = defaultSend }) {
  if (typeof functionName !== "string" || !functionName) throw new Error("the store's function name is required");
  return async (payload) => {
    const out = await send({ FunctionName: functionName, InvocationType: "RequestResponse", Payload: Buffer.from(payload) });
    if (out?.FunctionError) throw new Error(`store function error: ${out.FunctionError}`);
    if (out?.StatusCode !== 200) throw new Error(`store invoke status ${out?.StatusCode}`);
    return Buffer.from(out.Payload ?? []).toString("utf8");
  };
}
