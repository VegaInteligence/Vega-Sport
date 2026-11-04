"""Post-deploy read-only HTTP acceptance; always save the (redacted) evidence report."""
import argparse
import hashlib
import http.client
import json
from pathlib import Path
import time
from urllib.parse import urlsplit
from release import STACK, stack

p = argparse.ArgumentParser()
p.add_argument("path", help="stable cacheable JSON API with positive s-maxage and ETag, include actual query")
p.add_argument("evidence")
args = p.parse_args()
if not args.path.startswith("/") or args.path.startswith("//"):
    p.error("expected API path")
s = stack(STACK)
if not s:
    p.error("stack absent")
outputs = {o["OutputKey"]: o["OutputValue"] for o in s["Outputs"]}
checks = []
rows = []
report = dict(command=["python3","infra/aws-backend/public-smoke.py",args.path,args.evidence],
              utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), stackStatus=s["StackStatus"],
              api=outputs["ApiOrigin"], distribution=outputs["DistributionId"], requests=rows, checks=checks)


def fetch(url,path,method="GET",headers=None):
    h = {"Origin": "https://statarena-analytics.vercel.app", "Accept-Encoding": "identity", **(headers or {})}
    conn = http.client.HTTPSConnection(urlsplit(url).hostname, timeout=30)
    try:
        start=time.monotonic()
        conn.request(method,path,headers=h)
        r=conn.getresponse()
        b=r.read()
        meta = dict(method=method,path=path,host=urlsplit(url).hostname, requestHeaders=h,
                    status=r.status,elapsedMs=round((time.monotonic()-start)*1000,1),bytes=len(b),
                    sha256=hashlib.sha256(b).hexdigest(),headers={k.lower():v for k,v in r.getheaders()
                    if k.lower() in ("x-cache","etag","content-type","cache-control","age","access-control-allow-origin",
                                      "access-control-allow-methods","x-amz-cf-pop","x-amz-cf-id","content-encoding","content-length")})
        rows.append(meta)
        return meta,b
    finally:
        conn.close()


def expect(message,condition):
    checks.append({"expected":message,"passed":bool(condition)})


try:
    api=outputs["ApiOrigin"]
    direct,_=fetch(outputs["SignedOrigin"],"/api/health")
    expect("unsigned Lambda origin returns 403",direct["status"]==403)
    h,b=fetch(api,"/api/health")
    expect("public health responds 200 with application JSON",h["status"]==200 and isinstance(json.loads(b),dict))
    get,data=fetch(api,args.path)
    again,data2=fetch(api,args.path)
    tag=get["headers"].get("etag")
    expect("stable JSON route GET 200 and repeated bytes equal",get["status"]==again["status"]==200
           and data==data2 and isinstance(json.loads(data),(dict,list)))
    expect("warm edge hit",again["headers"].get("x-cache","").lower().startswith("hit"))
    expect("public CORS allows browser frontend",again["headers"].get("access-control-allow-origin")=="*")
    expect("route includes an ETag",tag)
    if tag:
        conditional,empty=fetch(api,args.path,headers={"If-None-Match":tag})
        expect("If-None-Match returns empty 304",conditional["status"]==304 and not empty)
    head,empty=fetch(api,args.path,"HEAD")
    expect("HEAD status and ETag align with GET; no body",head["status"]==200 and not empty and head["headers"].get("etag")==tag)
    opt,_=fetch(api,args.path,"OPTIONS",{"Access-Control-Request-Method":"GET","Access-Control-Request-Headers":"If-None-Match"})
    expect("CORS preflight accepted",opt["status"]==204 and "GET" in opt["headers"].get("access-control-allow-methods",""))
    refused,_=fetch(api,args.path,"POST")
    expect("viewer write methods refused",refused["status"] in (403,405))
except Exception as e:
    report["error"]=type(e).__name__
finally:
    report["passed"]=bool(checks) and all(c["passed"] for c in checks) and "error" not in report
    Path(args.evidence).write_text(json.dumps(report,indent=2)+"\n")
    print("PASS" if report["passed"] else "FAIL",args.evidence)
raise SystemExit(0 if report["passed"] else 1)
