"""Links cannot establish byte-level equivalence of a worker's migrations."""
import io
from pathlib import Path
import sys
import tarfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infra/aws"))
from migration_manifest import Unreadable, manifest


class MigrationManifestTest(unittest.TestCase):
    def test_links_in_migration_paths_are_reported_as_unreadable(self):
        links = (
            ("app/sql/001_core.sql", tarfile.SYMTYPE, "../shared/core.sql"),
            ("app/sql/001_core.sql", tarfile.LNKTYPE, "app/shared/core.sql"),
            ("app/account", tarfile.SYMTYPE, "shared/account"),
            ("app/panna/sql", tarfile.SYMTYPE, "../shared/sql"),
        )
        for name, kind, target in links:
            with self.subTest(path=name, type=kind):
                data = io.BytesIO()
                with tarfile.open(fileobj=data, mode="w") as archive:
                    sql = b"select 1;\n"
                    real = tarfile.TarInfo("app/shared/core.sql")
                    real.size = len(sql)
                    archive.addfile(real, io.BytesIO(sql))
                    linked = tarfile.TarInfo(name)
                    linked.type = kind
                    linked.linkname = target
                    archive.addfile(linked)
                with self.assertRaisesRegex(Unreadable, "migration.*link|migration.*ordinary"):
                    manifest(data.getvalue())
