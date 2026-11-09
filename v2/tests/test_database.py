import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from vega_v2.database import connect_database, HOST
from vega_v2.store import StoreError


class DatabaseTargetTest(unittest.TestCase):
    def test_legacy_remote_url_is_never_a_v2_target(self):
        with patch("vega_v2.database.psycopg.connect") as connect:
            with self.assertRaises(StoreError):
                connect_database(
                    "postgresql://user:fixture@" + HOST + "/statarena_prod"
                )
            connect.assert_not_called()

    def test_shared_instance_requires_new_database_and_verified_tls(self):
        with tempfile.TemporaryDirectory() as directory:
            ca = Path(directory) / "ca.pem"
            ca.write_text("synthetic test CA")
            settings = {
                "V2_DB_HOST": HOST,
                "V2_DB_NAME": "vega_v2",
                "V2_DB_USER": "vega_v2_ingest",
                "V2_DB_TARGET_INSTANCE": "statarena-postgres",
                "V2_DB_PASSWORD": "synthetic-password",
                "AWS_REGION": "us-east-2",
                "PGSSLROOTCERT": str(ca),
                "PGSSLMODE": "disable",
            }
            conn = Mock()
            conn.execute.return_value.fetchone.return_value = (
                "vega_v2",
                "vega_v2_ingest",
            )
            with patch.dict(os.environ, settings, clear=True), patch(
                "vega_v2.database.psycopg.connect", return_value=conn
            ) as connect:
                self.assertIs(connect_database(), conn)
                self.assertEqual(connect.call_args.kwargs["sslmode"], "verify-full")
                self.assertEqual(connect.call_args.kwargs["host"], HOST)
                os.environ["V2_DB_NAME"] = "statarena_prod"
                with self.assertRaises(StoreError):
                    connect_database()
                self.assertEqual(connect.call_count, 1)

    def test_server_identity_mismatch_closes_connection(self):
        with tempfile.TemporaryDirectory() as directory:
            ca = Path(directory) / "ca.pem"
            ca.write_text("synthetic test CA")
            settings = {
                "V2_DB_HOST": HOST,
                "V2_DB_NAME": "vega_v2",
                "V2_DB_USER": "vega_v2_reader",
                "V2_DB_TARGET_INSTANCE": "statarena-postgres",
                "V2_DB_PASSWORD": "synthetic-password",
                "AWS_REGION": "us-east-2",
                "PGSSLROOTCERT": str(ca),
            }
            conn = Mock()
            conn.execute.return_value.fetchone.return_value = (
                "statarena_prod",
                "vega_v2_reader",
            )
            with patch.dict(os.environ, settings, clear=True), patch(
                "vega_v2.database.psycopg.connect", return_value=conn
            ):
                with self.assertRaises(StoreError):
                    connect_database()
                conn.close.assert_called_once()
