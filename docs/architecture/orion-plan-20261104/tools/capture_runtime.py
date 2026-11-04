"""Read-only service configuration, with values of credentials never exported."""
import concurrent.futures
import datetime
import json
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parents[1] / "evidence"


def aws(*args):
    return json.loads(subprocess.check_output(["aws", "--profile", "statarena", "--region", "us-east-2", *args, "--output", "json"], text=True))


def health(url):
    with urllib.request.urlopen(url, timeout=20) as response:
        return {"url": url, "status": response.status, "body": json.loads(response.read(2048))}


account = aws("sts", "get-caller-identity")["Account"]
assert account == "361769570630"
report = {"atUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "account": account,
          "command": "python3 docs/architecture/orion-plan-20261104/tools/capture_runtime.py",
          "mode": "Read-only Describe/Get/list calls and public health GETs; no deployment, credentials export or object body downloads."}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    calls = {
        "rds": pool.submit(aws, "rds", "describe-db-instances", "--db-instance-identifier", "statarena-postgres"),
        "lambda": pool.submit(aws, "lambda", "get-function-configuration", "--function-name", "statarena-backend"),
        "apiCdn": pool.submit(aws, "cloudfront", "get-distribution", "--id", "E26GD325YNN0LL"),
        "assetCdn": pool.submit(aws, "cloudfront", "get-distribution", "--id", "E3IHCBKMHSDYC6"),
    }
    values = {k: f.result() for k, f in calls.items()}
db = values["rds"]["DBInstances"][0]
report["rds"] = {k: db.get(k) for k in ("DBInstanceIdentifier", "Engine", "EngineVersion", "DBInstanceClass", "AllocatedStorage", "StorageType", "DBInstanceStatus", "PendingModifiedValues", "DBName", "VpcSecurityGroups", "PubliclyAccessible", "StorageEncrypted", "BackupRetentionPeriod")}
fn = values["lambda"]
report["lambda"] = {k: fn.get(k) for k in ("FunctionName", "Runtime", "MemorySize", "Timeout", "CodeSha256", "State", "LastUpdateStatus", "VpcConfig")}
env = fn.get("Environment", {}).get("Variables", {})
url = urllib.parse.urlsplit(env.get("DATABASE_URL", ""))
report["lambda"]["databaseTarget"] = {"host": url.hostname, "database": url.path.lstrip("/"), "role": url.username}
report["lambda"]["environmentKeys"] = sorted(env)
report["lambda"]["assetOrigin"] = env.get("STATARENA_CLOUDFRONT_URL")
report["lambda"]["dataProvider"] = env.get("STATARENA_DATA_PROVIDER")
sgs = set(x["VpcSecurityGroupId"] for x in db["VpcSecurityGroups"])
sgs.update(fn.get("VpcConfig", {}).get("SecurityGroupIds", []))
report["networkSecurityGroups"] = aws("ec2", "describe-security-groups", "--group-ids", *sorted(sgs))["SecurityGroups"]
for group in report["networkSecurityGroups"]:
    for direction in ("IpPermissions", "IpPermissionsEgress"):
        for permission in group.get(direction, []):
            for address in permission.get("IpRanges", []):
                cidr = address.get("CidrIp", "")
                if cidr.endswith("/32"):
                    address.pop("CidrIp")
                    address.update(CidrPrefixLength=32, AddressRedacted=True)
report["redaction"] = "Personal /32 administrator IP addresses are omitted from this public-repository receipt; rule descriptions/counts and SG references are retained."
for name in ("apiCdn", "assetCdn"):
    dist = values[name]["Distribution"]
    cfg = dist["DistributionConfig"]
    report[name] = {"id": dist["Id"], "domain": dist["DomainName"], "status": dist["Status"],
                    "aliases": cfg["Aliases"], "origins": cfg["Origins"],
                    "defaultBehavior": cfg["DefaultCacheBehavior"], "cacheBehaviors": cfg["CacheBehaviors"]}
    policy_id = cfg["DefaultCacheBehavior"].get("CachePolicyId")
    if policy_id:
        report[name]["cachePolicy"] = aws("cloudfront", "get-cache-policy", "--id", policy_id)
    header_id = cfg["DefaultCacheBehavior"].get("ResponseHeadersPolicyId")
    if header_id:
        report[name]["responseHeadersPolicy"] = aws("cloudfront", "get-response-headers-policy", "--id", header_id)
report["publicHealth"] = health("https://statarena-analytics.vercel.app/api/health")
report["awsHealth"] = health("https://d317dq37z1tacb.cloudfront.net/api/health")
report["workflows"] = json.loads(subprocess.check_output(["gh", "workflow", "list", "--all", "--json", "id,name,path,state"], cwd=ROOT, text=True))
report["finishedUtc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
(OUT / "runtime-current.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"account": account, "rds": report["rds"], "databaseTarget": report["lambda"]["databaseTarget"], "health": [report[k]["body"] for k in ("publicHealth", "awsHealth")]}))
