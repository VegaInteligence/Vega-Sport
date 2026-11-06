"""Decode the historical columnar interchange format used by AWS ingestion."""

def unpack(t):
    result = []
    for i, row in enumerate(t["rows"]):
        missing = t.get("missing", {}).get(str(i), [])
        d = t.get("dictionaries", {})
        result.append(
            {
                k: (d[str(j)][row[j]] if str(j) in d and row[j] is not None else row[j])
                for j, k in enumerate(t["keys"])
                if j not in missing
            }
        )
    return result

