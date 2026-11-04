"""Translate imported source names into native catalog identities, offline only."""

import re


def season(label):
    return re.sub(r"^(\d{4})-(\d{4})$", r"\1/\2", label)


def records(path, value):
    """(model, catalog, scope, edition, typed input). No path is stored as a runtime lookup key."""
    if re.fullmatch(r"/(leagues|teams|players)(/[ltp]_[A-Za-z0-9]{6})?", path):
        parts = path.strip("/").split("/")
        yield (
            "profile_" + (parts[0] if len(parts) > 1 else "catalog"),
            "profile",
            parts[0],
            parts[1] if len(parts) > 1 else "",
            value,
        )
        return
    if path == "raw/supplemental-index.json" or path == "raw/cup-worker/index.json":
        worker = path.startswith("raw/cup-worker/")
        yield (
            "cup_worker_index" if worker else "supp_index",
            "cup-index",
            "worker" if worker else "supplemental",
            "",
            value,
        )
        return
    if path == "raw/rankings/index.json":
        yield ("ranking_index", "ranking-index", "", "", value)
        return
    if path == "raw/rankings/club-links.json":
        yield ("club_links", "club-links", "", "", value)
        return
    m = re.fullmatch(
        r"raw/(openfootball|historical-goals)/([^/]+)\.json(?:\.gz)?", path
    )
    if m:
        kind = "results" if m[1] == "openfootball" else "goals"
        if m[2] == "index":
            yield ("archive_" + kind + "_index", "archive-index", kind, "", value)
        else:
            yield ("archive_" + kind, "archive-season", kind, value["season"], value)
        return
    m = re.fullmatch(r"raw/rankings/([^/]+)/([^/]+)\.json", path)
    if m:
        model = "ranking_" + (
            "sportsapi" if value["provider"] == "SportsAPI" else m[1].replace("-", "_")
        )
        yield (model, "ranking", m[1], m[2], value)
        return
    m = re.fullmatch(
        r"raw/cup-worker/(native|open-cups|standings|openligadb|nations-results)/([^/]+)/([^/]+)\.json",
        path,
    )
    if m:
        yield (
            "cup_" + m[1].replace("-", "_"),
            "cup-" + m[1],
            m[2],
            season(m[3]),
            value,
        )
        return
    m = re.fullmatch(
        r"raw/cup-worker/supplemental/([^/]+)/([^/]+)/(results|fixtures|goals)-[0-9a-f]+\.json",
        path,
    )
    if m:
        # Immutable object versions are activated only by a matching cup index digest.
        yield (
            "supp_" + m[3],
            "worker-" + m[3],
            m[2],
            season(m[1]) + ":" + path.rsplit("-", 1)[1].split(".")[0],
            {"rows": value},
        )
        return
    m = re.fullmatch(
        r"raw/seasons/([^/]+)/supplemental_(results|fixtures|goals)/([^/]+)\.json\.gz",
        path,
    )
    if m:
        yield ("supp_" + m[2], "supp-" + m[2], m[3], season(m[1]), {"rows": value})
        return
    m = re.fullmatch(r"computed/matchdays/([^/]+)\.json\.gz", path)
    if m:
        for league, rounds in value.items():
            yield ("matchdays", "matchdays", league, season(m[1]), {"matches": rounds})
