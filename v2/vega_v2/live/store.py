"""The live store (doc "Store live": DynamoDB, on demand), never core.

Three tables, typed attributes, every item with expires_at (epoch seconds, DynamoDB's TTL
attribute; reads filter on it, the automatic deletion takes days):
- state  (match): status, minute, period, score, the core match and teams once linked,
  the families core already has (core_families);
- events (match, seq): goals, cards, substitutions, VAR, with the core player id when known;
- stats  (match, key = side#period): the team statistics the provider gives.
"""

from decimal import Decimal

STATE, EVENTS, STATS = "state", "events", "stats"


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


class MemoryStore:
    """The same interface in memory (tests, dry runs)."""

    def __init__(self):
        self.tables = {STATE: {}, EVENTS: {}, STATS: {}}

    def get_state(self, match):
        item = self.tables[STATE].get(match)
        return dict(item) if item else None

    def states(self):
        return [dict(v) for v in self.tables[STATE].values()]

    def put_state(self, item):
        self.tables[STATE][item["match"]] = dict(item)

    def events(self, match):
        return sorted((dict(v) for (m, _), v in self.tables[EVENTS].items() if m == match), key=lambda e: e["seq"])

    def put_event(self, item):
        self.tables[EVENTS][(item["match"], item["seq"])] = dict(item)

    def stats(self, match):
        return sorted((dict(v) for (m, _), v in self.tables[STATS].items() if m == match), key=lambda s: s["key"])

    def put_stats(self, item):
        self.tables[STATS][(item["match"], item["key"])] = dict(item)

    def set_expiry(self, match, expires_at):
        for table in self.tables.values():
            for key, item in table.items():
                if (key if isinstance(key, str) else key[0]) == match:
                    item["expires_at"] = expires_at


class DynamoStore:
    """The live tables in DynamoDB (infra/aws-v2/live.yaml)."""

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
            args = {"TableName": self.names[table], "KeyConditionExpression": "#m = :m",
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
            args = {"TableName": self.names[STATE]}
            if start:
                args["ExclusiveStartKey"] = start
            page = self.client.scan(**args)
            items += [self._plain(i) for i in page.get("Items", [])]
            start = page.get("LastEvaluatedKey")
            if not start:
                return items

    def put_state(self, item):
        self.client.put_item(TableName=self.names[STATE], Item=self._item(item))

    def events(self, match):
        return sorted(self._query(EVENTS, match), key=lambda e: e["seq"])

    def put_event(self, item):
        self.client.put_item(TableName=self.names[EVENTS], Item=self._item(item))

    def stats(self, match):
        return sorted(self._query(STATS, match), key=lambda s: s["key"])

    def put_stats(self, item):
        self.client.put_item(TableName=self.names[STATS], Item=self._item(item))

    def set_expiry(self, match, expires_at):
        keys = [(STATE, {"match": {"S": match}})]
        keys += [(EVENTS, {"match": {"S": match}, "seq": {"N": str(e["seq"])}}) for e in self.events(match)]
        keys += [(STATS, {"match": {"S": match}, "key": {"S": s["key"]}}) for s in self.stats(match)]
        for table, key in keys:
            self.client.update_item(TableName=self.names[table], Key=key, UpdateExpression="SET expires_at = :e",
                                    ExpressionAttributeValues={":e": {"N": str(int(expires_at))}})
