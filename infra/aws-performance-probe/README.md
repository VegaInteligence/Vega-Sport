# Temporary Paris HTTP acceptance

This probe performs bounded public GETs from AWS `eu-west-3` (Paris). Its role
can write only its own logs. It has no database access, credentials supplied by
the application, public function URL, trigger, or persistent schedule.

Generate a CloudFormation JSON template with `python3 template.py`. Deploy it
in `eu-west-3` with `CAPABILITY_IAM`; invoke the named function manually, then
delete the entire stack after saving the returned receipts. The stack name is
deliberately specific to this acceptance session.

An invocation accepts `path`, `mode` (`warm` or `miss`) and `count` (1–50).
Only `/api/read/home`, `/api/read/players` and `/api/read/clubs` are accepted.
Use the same published generation, season and ten-league scope for comparison.
Every trial opens a new HTTPS connection, reads the complete body and records
headers and full-response duration, HTTP status, body size, digest, generation,
CloudFront cache state and point of presence. Requests are sequential with a
150 ms pause. An HTTP error, exception or insufficient remaining runtime stops
the sample; incomplete samples must not be reported as passing.

`warm` performs an explicitly excluded warmup, followed by repeated identical
requests. `miss` generates different permutations of the same league IDs:
CloudFront keys the raw query while `parseReadScope` deduplicates and sorts
those IDs. No unknown query parameter or cache invalidation is used. Classify
the actual `X-Cache` values in the receipt; do not infer cache state from the
requested mode alone.

The empirical p95 is the nearest rank `ceil(0.95*n)` (48th ordered observation
for 50 trials). This is a small synthetic sample from AWS Paris, not a guarantee
for all French users. A shared-cache miss does not establish a cold Lambda or
cold PostgreSQL cache. Preserve outliers and errors. Compare CloudWatch errors,
throttles and database load over the same observation window when running the
three route samples concurrently.

References: [Lambda regions](https://docs.aws.amazon.com/general/latest/gr/lambda-service.html),
[inline CloudFormation code](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-function-code.html),
and the deployed policy in `infra/aws-backend/backend.yaml`.
