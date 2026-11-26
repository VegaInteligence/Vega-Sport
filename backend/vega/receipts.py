"""Bounded preparation of the read API's content receipts from the normal worker round."""
import os
from pathlib import Path
import subprocess


def refresh(dsn, *, budget=20, check=200, list_missing=True):
    script = Path(__file__).resolve().parents[1] / "api" / "src" / "receipt-worker.mjs"
    if not script.is_file():
        # In the worker image the shared backend API retains its source layout.
        script = Path("/app/backend/api/src/receipt-worker.mjs")
    result = subprocess.run(
        ["node", str(script), str(budget), str(check), "1" if list_missing else "0"],
        env={**os.environ, "VEGA_RECEIPTS_DSN": dsn},
        text=True,
        stdout=subprocess.PIPE,
        timeout=10,
        check=True,
    )
    return int(result.stdout.strip() or 0)
