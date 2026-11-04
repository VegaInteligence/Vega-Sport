"""Isolated account-bound release. dry-run is read-only. No interactive credentials or shell."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from urllib.parse import quote
from zipfile import ZipFile
from package import HERE, build

ACCOUNT = "361769570630"
REGION = "us-east-2"
STACK = "statarena-backend"
BUCKET = f"{STACK}-releases-{ACCOUNT}-{REGION}"
HOST = "statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com"


def aws(*args, absent=None):
    p = subprocess.run(["aws", "--profile", "statarena", "--region", REGION,
                        "--no-cli-pager", "--output", "json", *args],
                       capture_output=True, text=True)
    if p.returncode:
        if absent and absent in p.stderr:
            return None
        # Do not print raw errors/inputs from AWS: they may contain a parameter.
        code = re.search(r'\(([\w.-]+)\) when calling', p.stderr)
        raise SystemExit(f"AWS {args[0]} {args[1]} failed: {code.group(1) if code else p.returncode}")
    try:
        return json.loads(p.stdout) if p.stdout.strip() else {}
    except ValueError:
        return {}


def check():
    ident = aws("sts", "get-caller-identity")["Account"]
    if ident != ACCOUNT:
        raise SystemExit("unexpected AWS account")
    for f in ("artifacts.yaml", "backend.yaml"):
        aws("cloudformation", "validate-template", "--template-body", "file://" + str(HERE / f))
    limits = aws("lambda", "get-account-settings")["AccountLimit"]
    # This release deliberately shares this small account's existing 10 invocations.
    # If quotas change, update the design rather than silently overloading RDS.
    if not 0 < limits["ConcurrentExecutions"] <= 10:
        raise SystemExit("account limit changed: review DB capacity and explicit reserved concurrency")
    db = aws("rds", "describe-db-instances", "--db-instance-identifier", "statarena-postgres")["DBInstances"][0]
    if (db["Endpoint"]["Address"] != HOST or db["Endpoint"]["Port"] != 5432
        or db["DBSubnetGroup"]["VpcId"] != "vpc-08e400afa07fc1812"
        or "sg-0667c20e8ff5d2431" not in {s["VpcSecurityGroupId"] for s in db["VpcSecurityGroups"]}):
        raise SystemExit("RDS network identity changed; review")
    return {"account": ident, "region": REGION, "concurrencyLimit": limits["ConcurrentExecutions"],
            "rdsStatus": db["DBInstanceStatus"], "validatedTemplates": ["artifacts.yaml", "backend.yaml"]}


def stack(name):
    result = aws("cloudformation", "describe-stacks", "--stack-name", name, absent="does not exist")
    if result is None:
        return None
    item = result["Stacks"][0]
    if {"Key": "Application", "Value": STACK} not in item.get("Tags", []):
        raise SystemExit("refusing to modify unowned stack")
    return item


def release_key(path):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if path.name != digest + ".zip":
        raise SystemExit("release filename must match SHA-256")
    with ZipFile(path) as z:
        if set(z.namelist()) != {"index.mjs", "rds-ca.pem"} or len(z.namelist()) != 2:
            raise SystemExit("unexpected release ZIP contents")
    return "releases/" + path.name


def prepare(path):
    history = subprocess.run(["aws", "--profile", "statarena", "configure", "get", "cli_history"],
                             capture_output=True, text=True)
    if history.returncode not in (0, 1) or history.stdout.strip().lower() not in ("", "disabled"):
        raise SystemExit("disable AWS CLI history before handling runtime credentials")
    key = release_key(path)
    if not stack(STACK + "-artifacts"):
        raise SystemExit("run bootstrap first")
    prior = aws("s3api", "head-object", "--expected-bucket-owner", ACCOUNT, "--bucket", BUCKET,
                "--key", key, absent="(404)")
    # A checksum-verified, write-once release object supports deterministic rollback.
    import base64
    checksum = base64.b64encode(bytes.fromhex(path.stem)).decode()
    if prior is None:
        aws("s3api", "put-object", "--expected-bucket-owner", ACCOUNT, "--bucket", BUCKET,
            "--key", key, "--body", str(path), "--if-none-match", "*", "--checksum-sha256", checksum)
    else:
        info = aws("s3api", "head-object", "--expected-bucket-owner", ACCOUNT, "--bucket", BUCKET,
                   "--key", key, "--checksum-mode", "ENABLED")
        if info.get("ChecksumSHA256") != checksum:
            raise SystemExit("release object checksum mismatch")
    param = aws("ssm", "get-parameter", "--name", "/statarena/app/rds-runtime",
                "--with-decryption")["Parameter"]
    if param["Type"] != "SecureString":
        raise SystemExit("runtime parameter must be encrypted")
    c = json.loads(param["Value"])
    if c.get("host") != HOST or c.get("database") != "statarena_prod" or not c.get("username") or not c.get("password"):
        raise SystemExit("invalid runtime parameter target")
    url = "postgresql://" + quote(c["username"], safe="") + ":" + quote(c["password"], safe="") + "@" + HOST + ":5432/statarena_prod"
    name = "release-" + time.strftime("%Y%m%d%H%M%S", time.gmtime()) + "-" + path.stem[:12]
    existing = stack(STACK)
    if existing and existing["StackStatus"] not in ("CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE", "REVIEW_IN_PROGRESS"):
        raise SystemExit("backend stack not ready for a change set")
    with tempfile.TemporaryDirectory(prefix="statarena-params-") as d:
        params = Path(d) / "parameters.json"
        with open(params, "x", opener=lambda name,flags: os.open(name,flags,0o600)) as f:
            json.dump([{"ParameterKey":"ReleaseKey","ParameterValue":key},
                       {"ParameterKey":"DatabaseUrl","ParameterValue":url}], f)
        aws("cloudformation", "create-change-set", "--stack-name", STACK, "--change-set-name", name,
            "--change-set-type", "UPDATE" if existing and existing["StackStatus"] != "REVIEW_IN_PROGRESS" else "CREATE",
            "--template-body", "file://" + str(HERE / "backend.yaml"), "--capabilities", "CAPABILITY_IAM",
            "--tags", "Key=Application,Value=" + STACK, "--parameters", "file://" + str(params))
    aws("cloudformation", "wait", "change-set-create-complete", "--stack-name", STACK, "--change-set-name", name)
    changes = aws("cloudformation", "describe-change-set", "--stack-name", STACK, "--change-set-name", name)
    return {"changeSet": name, "release": key, "changes":[{k: c["ResourceChange"].get(k) for k in
              ("Action","LogicalResourceId","ResourceType","Replacement")} for c in changes["Changes"]]}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=["dry-run","bootstrap","prepare","execute","status"])
    p.add_argument("target", nargs="?")
    args = p.parse_args()
    preflight = check()
    if args.action == "dry-run":
        # No SSM reads, artifact upload, change set or resource mutation.
        with tempfile.TemporaryDirectory() as d:
            path = build(Path(d))
            print(json.dumps(dict(preflight, release=release_key(path), bytes=path.stat().st_size), indent=2))
    elif args.action == "bootstrap":
        stack(STACK + "-artifacts") # ownership guard on updates
        aws("cloudformation","deploy","--stack-name",STACK+"-artifacts","--template-file",str(HERE/"artifacts.yaml"),
            "--tags","Application="+STACK,"--no-fail-on-empty-changeset")
        print("Private release bucket ready")
    elif args.action == "prepare" and args.target:
        print(json.dumps(prepare(Path(args.target).resolve()), indent=2))
    elif args.action == "execute" and args.target:
        if not re.fullmatch(r"release-[0-9]{14}-[a-f0-9]{12}", args.target):
            raise SystemExit("expected a prepared release change set name")
        cs=aws("cloudformation","describe-change-set","--stack-name",STACK,"--change-set-name",args.target)
        if cs["ExecutionStatus"]!="AVAILABLE" or cs["StackName"]!=STACK:
            raise SystemExit("change set unavailable")
        aws("cloudformation","execute-change-set","--stack-name",STACK,"--change-set-name",args.target)
        print("Executed; poll status until complete, then run public acceptance.")
    elif args.action == "status":
        obj=stack(STACK)
        print(json.dumps({"status":obj["StackStatus"],"outputs":obj.get("Outputs",[])} if obj else {"status":"absent"}, indent=2))
    else:
        p.error("missing target")

if __name__ == "__main__":
    main()
