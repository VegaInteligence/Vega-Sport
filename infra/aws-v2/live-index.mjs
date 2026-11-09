// Lambda entry of GET /live/matches/{id} (v2/api/src/live.mjs): the live tables in
// DynamoDB, read with the AWS SDK the Node.js runtime provides (loaded on first read, so
// the offline packaging check needs none). Outside the private network: no database.
// Strongly consistent reads: the state's revision and its items are compared as written.
import { adapt } from "../aws-backend/transport.mjs";
import { createLiveHandler } from "../../v2/api/src/live.mjs";

const TABLES = {
  state: process.env.V2_LIVE_STATE_TABLE,
  events: process.env.V2_LIVE_EVENTS_TABLE,
  stats: process.env.V2_LIVE_STATS_TABLE,
};
let sdk;
async function dynamo() {
  if (!sdk) {
    const [client, util] = await Promise.all([import("@aws-sdk/client-dynamodb"), import("@aws-sdk/util-dynamodb")]);
    sdk = { client: new client.DynamoDBClient({}), GetItemCommand: client.GetItemCommand, QueryCommand: client.QueryCommand, unmarshall: util.unmarshall };
  }
  return sdk;
}
async function query(table, match) {
  const { client, QueryCommand, unmarshall } = await dynamo();
  const items = [];
  let start;
  do {
    const page = await client.send(new QueryCommand({
      TableName: TABLES[table], KeyConditionExpression: "#m = :m", ExpressionAttributeNames: { "#m": "match" },
      ExpressionAttributeValues: { ":m": { S: match } }, ExclusiveStartKey: start, ConsistentRead: true,
    }));
    items.push(...(page.Items || []).map((item) => unmarshall(item)));
    start = page.LastEvaluatedKey;
  } while (start);
  return items;
}
const read = {
  async state(match) {
    const { client, GetItemCommand, unmarshall } = await dynamo();
    const out = await client.send(new GetItemCommand({ TableName: TABLES.state, Key: { match: { S: match } }, ConsistentRead: true }));
    return out.Item ? unmarshall(out.Item) : null;
  },
  events: (match) => query("events", match),
  stats: (match) => query("stats", match),
};
export const handler = adapt(createLiveHandler(read));
