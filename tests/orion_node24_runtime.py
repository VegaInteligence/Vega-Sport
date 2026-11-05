"""Verify the actual E2E Node binary against a pinned official platform archive."""
from __future__ import annotations

import hashlib
from pathlib import Path
import tarfile

SUMS_SHA = "aec92ae945293821c22aed4c37b97741688254bac353b861fc9fb25b81ce4567"
ARCHIVES = {
    ("darwin", "arm64"): "1f5ac075be50bed4780ea3be19a007fda95ea4d527d28d76d0b91de47d915115",
    ("linux", "x64"): "48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75",
}


def stream_sha(stream):
    digest = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
    return digest.hexdigest()


def verify_node24_runtime(binary, runtime, sums):
    assert runtime["version"] == "v24.22.2" and runtime["rawJSON"] == "function"
    platform = (runtime["platform"], runtime["arch"])
    assert platform in ARCHIVES, "Unqualified Node platform"
    sums = Path(sums)
    assert hashlib.sha256(sums.read_bytes()).hexdigest() == SUMS_SHA
    directory = "node-" + runtime["version"] + "-" + "-".join(platform)
    filename = directory + ".tar.xz"
    expected = ARCHIVES[platform]
    official = dict(line.split()[::-1] for line in sums.read_text().splitlines() if line.strip())
    assert official[filename] == expected
    binary = Path(binary).resolve(strict=True)
    assert binary.name == "node" and binary.parent.name == "bin" and binary.parent.parent.name == directory
    archive = binary.parents[2] / filename
    with archive.open("rb") as source:
        assert stream_sha(source) == expected, "Node archive differs from official hash"
    with binary.open("rb") as source:
        binary_sha = stream_sha(source)
    with tarfile.open(archive, "r:xz") as bundle:
        member = bundle.getmember(directory + "/bin/node")
        assert member.isfile() and member.size == binary.stat().st_size
        with bundle.extractfile(member) as source:
            assert stream_sha(source) == binary_sha, "Executed Node differs from the verified archive"
    return {"archive": str(archive), "archiveSha256": expected, "binarySha256": binary_sha,
            "officialSumsSha256": SUMS_SHA, "actualBinaryMatchesArchive": True}
