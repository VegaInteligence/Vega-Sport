"""The live store (doc "Store live": DynamoDB, on demand), never core.

Three tables (doc "Tables temporaires"), typed attributes, a revision and expires_at
(epoch seconds, DynamoDB's TTL attribute; reads filter on it, the deletion takes days):
- state  (match): match_id (core id), status, minute, minute_added, period, home_score,
  away_score, revision, updated_at, the core teams, the families core already has, and
  the match's lease (lease_owner, lease_until);
- events (match, seq): provider_event_id, revision, event_type, minute, minute_added,
  team_id, player_id, related_player_id, player_name, is_cancelled, received_at;
- team stats (match, team_id): possession_pct, total_shots, shots_on_target, corners,
  fouls, revision.
`match` is the public core id the site and the routes know (m_…).

A revision is written atomically: its events and statistics first, the state (which
carries the revision) last, in one transaction. The full-state read (live.mjs) keeps a
snapshot whose items are all at or below the state's revision, so it never mixes two.
"""

from decimal import Decimal

STATE, EVENTS, STATS = "state", "events", "stats"
INGESTOR = "lease#ingestor"  # the single ingestor's own lease, in the state table


def _plain(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if isinstance(value, set):
        return sorted(_plain(v) for v in value)
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return value


def _free(item, owner, now):
    return not item or item.get("lease_owner") in (None, owner) or item.get("lease_until", 0) < now


class MemoryStore:
    """The same interface in memory (tests, dry runs)."""

    def __init__(self):
        self.tables = {STATE: {}, EVENTS: {}, STATS: {}}

    def get_state(self, match):
        item = self.tables[STATE].get(match)
        return dict(item) if item else None

    def states(self):
        return [dict(v) for k, v in self.tables[STATE].items() if k != INGESTOR]

    def put_state(self, item):
        self.tables[STATE][item["match"]] = dict(item)

    def events(self, match):
        return sorted((dict(v) for (m, _), v in self.tables[EVENTS].items() if m == match), key=lambda e: e["seq"])

    def stats(self, match):
        return sorted((dict(v) for (m, _), v in self.tables[STATS].items() if m == match), key=lambda s: s["team_id"])

    def write_round(self, state, events, stats):
        for item in events:
            self.tables[EVENTS][(item["match"], item["seq"])] = dict(item)
        for item in stats:
            self.tables[STATS][(item["match"], item["team_id"])] = dict(item)
        self.put_state(state)

    def lease(self, match, owner, until, now):
        """Take or renew the lease of a match (or of the ingestor); False if another holds it."""
        item = self.tables[STATE].get(match)
        if not _free(item, owner, now):
            return False
        if item is None:
            item = self.tables[STATE][match] = {"match": match}
        item.update(lease_owner=owner, lease_until=until)
        return True

    def set_expiry(self, match, expires_at):
        for table in self.tables.values():
            for key, item in table.items():
                if (key if isinstance(key, str) else key[0]) == match:
                    item["expires_at"] = expires_at


class DynamoStore:
    """The live tables in DynamoDB (infra/aws/live.yaml)."""

    def __init__(self, names, client=None):
        import boto3
        from boto3.dynamodb.types import TypeDeserializer, TypeSerializer

        self.names = names  # {"state": table, "events": table, "stats": table}
        self.client = client or boto3.client("dynamodb")
        self._to, self._from = TypeSerializer(), TypeDeserializer()

    def _item(self, item):
        return {k: self._to.serialize(Decimal(str(v)) if isinstance(v, float) else v) for k, v in item.items() if v is not None}

    def _plain(self, item):
        return _plain({k: self._from.deserialize(v) for k, v in item.items()})

    def _query(self, table, match):
        items, start = [], None
        while True:
            args = {"TableName": self.names[table], "KeyConditionExpression": "#m = :m", "ConsistentRead": True,
                    "ExpressionAttributeNames": {"#m": "match"}, "ExpressionAttributeValues": {":m": {"S": match}}}
            if start:
                args["ExclusiveStartKey"] = start
            page = self.client.query(**args)
            items += [self._plain(i) for i in page.get("Items", [])]
            start = page.get("LastEvaluatedKey")
            if not start:
                return items

    def get_state(self, match):
        item = self.client.get_item(TableName=self.names[STATE], Key={"match": {"S": match}}, ConsistentRead=True).get("Item")
        return self._plain(item) if item else None

    def states(self):
        items, start = [], None
        while True:
            args = {"TableName": self.names[STATE], "ConsistentRead": True}
            if start:
                args["ExclusiveStartKey"] = start
            page = self.client.scan(**args)
            items += [self._plain(i) for i in page.get("Items", [])]
            start = page.get("LastEvaluatedKey")
            if not start:
                return [i for i in items if i["match"] != INGESTOR]

    def put_state(self, item):
        self.client.put_item(TableName=self.names[STATE], Item=self._item(item))

    def events(self, match):
        return sorted(self._query(EVENTS, match), key=lambda e: e["seq"])

    def stats(self, match):
        return sorted(self._query(STATS, match), key=lambda s: s["team_id"])

    def write_round(self, state, events, stats):
        puts = [{"Put": {"TableName": self.names[EVENTS], "Item": self._item(e)}} for e in events]
        puts += [{"Put": {"TableName": self.names[STATS], "Item": self._item(s)}} for s in stats]
        puts.append({"Put": {"TableName": self.names[STATE], "Item": self._item(state)}})
        # 100 items per transaction: a round larger than that lands in order, the state last.
        for i in range(0, len(puts), 100):
            self.client.transact_write_items(TransactItems=puts[i:i + 100])

    def lease(self, match, owner, until, now):
        from botocore.exceptions import ClientError

        try:
            self.client.update_item(
                TableName=self.names[STATE], Key={"match": {"S": match}},
                UpdateExpression="SET lease_owner = :o, lease_until = :u",
                ConditionExpression="attribute_not_exists(lease_owner) OR lease_owner = :o OR lease_until < :n",
                ExpressionAttributeValues={":o": {"S": owner}, ":u": {"N": str(int(until))}, ":n": {"N": str(int(now))}},
            )
            return True
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                return False
            raise

    def set_expiry(self, match, expires_at):
        keys = [(STATE, {"match": {"S": match}})]
        keys += [(EVENTS, {"match": {"S": match}, "seq": {"N": str(e["seq"])}}) for e in self.events(match)]
        keys += [(STATS, {"match": {"S": match}, "team_id": {"S": s["team_id"]}}) for s in self.stats(match)]
        for table, key in keys:
            self.client.update_item(TableName=self.names[table], Key=key, UpdateExpression="SET expires_at = :e",
                                    ExpressionAttributeValues={":e": {"N": str(int(expires_at))}})
