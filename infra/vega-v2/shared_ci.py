"""Load only v2 ingest credentials into an existing GitHub Actions runner."""

import json
import os
from pathlib import Path
import subprocess
import uuid
import urllib.request

HOST = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com"
PARAMETER = "/statarena/v2/ingest"


def main():
    try:
        if (
            os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("GITHUB_REPOSITORY_ID") != "1441213700"
        ):
            raise ValueError()
        result = subprocess.run(
            [
                "aws",
                "ssm",
                "get-parameter",
                "--name",
                PARAMETER,
                "--with-decryption",
                "--region",
                "us-east-2",
                "--output",
                "json",
                "--no-cli-pager",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        value = json.loads(json.loads(result.stdout)["Parameter"]["Value"])
        if (
            value.get("host"),
            value.get("database"),
            value.get("username"),
            value.get("instance"),
        ) != (HOST, "vega_v2", "vega_v2_ingest", "statarena-postgres") or not value.get(
            "password"
        ):
            raise ValueError()
        print("::add-mask::" + value["password"])
        ca = Path(os.environ["RUNNER_TEMP"]) / "vega-v2-rds-ca.pem"
        urllib.request.urlretrieve(
            "https://truststore.pki.rds.amazonaws.com/us-east-2/us-east-2-bundle.pem",
            ca,
        )
        settings = {
            "V2_DB_HOST": HOST,
            "V2_DB_NAME": "vega_v2",
            "V2_DB_USER": "vega_v2_ingest",
            "V2_DB_TARGET_INSTANCE": "statarena-postgres",
            "V2_DB_PASSWORD": value["password"],
            "PGSSLROOTCERT": str(ca),
            "AWS_REGION": "us-east-2",
        }
        with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as output:
            for key, item in settings.items():
                delimiter = "VEGA_" + uuid.uuid4().hex
                output.write(
                    key + "<<" + delimiter + "\n" + item + "\n" + delimiter + "\n"
                )
        print("V2_SHARED_CONNECTION_READY")
        return 0
    except Exception:
        print("V2_SHARED_CONNECTION_FAILED")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
