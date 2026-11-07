"""The checked-in UTF-8 models must compile identically on every locale."""

import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard/scripts"))

import consolidated_model
import relational_catalog
import relational_support


class ModelEncodingTest(unittest.TestCase):
    def test_models_and_migration_digest(self):
        services = ROOT / "dashboard/backend/services"
        catalog = json.loads((services / "catalog-model.json").read_text(encoding="utf-8"))
        support = json.loads((services / "support-model.json").read_text(encoding="utf-8"))
        self.assertEqual(consolidated_model.CATALOG, catalog)
        self.assertEqual(relational_catalog.spec, catalog)
        self.assertEqual(consolidated_model.SUPPORT, support)
        self.assertEqual(relational_support._SPEC, support)
        migration = (ROOT / "dashboard/backend/migrations/023_consolidated_provider_records.sql").read_text(encoding="utf-8")
        expected = re.search(r'"model_digest": "([0-9a-f]{64})"', migration)
        self.assertIsNotNone(expected)
        self.assertEqual(consolidated_model.MODEL_DIGEST, expected.group(1))
        self.assertEqual(len(consolidated_model.BY_TABLE), 112)


if __name__ == "__main__":
    unittest.main()
