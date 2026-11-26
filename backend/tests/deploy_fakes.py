"""Stateful stand-ins of the tools infra/aws/deploy.sh calls, for its end-to-end tests (test_deploy_flow.py,
test_account_deploy.py; FAILURE_MODES_OPTIMISATIONS.md GH157/GH158).

One program, run under the names `aws`, `docker`, `python3`, `node` and `npm` (bin/<name> wrappers made by
`install`). Everything it knows and changes is one JSON state file (FAKE_STATE); every call is appended to FAKE_LOG.

- aws: CloudFormation stacks (status, parameters and the template's parameter keys, outputs; `deploy` keeps a previous
  value for a parameter it is not given, `update-stack --use-previous-template` resets one it is not given, as
  CloudFormation does), the worker stack's two services modelled from its parameters (desired count, task definition
  revision, starts, stops, replacements, a timeline), ECR (repository, images), ECS one-off tasks (the migrate task
  runs the real `python -m vega.migrate` of the image's own tree on FAKE_STATE's database, or a scripted exit code),
  SSM parameters with versions, S3 objects with conditional writes (If-None-Match, If-Match: 412). Errors are the CLI's
  (`An error occurred (<Code>) when calling the <Operation> operation: …`, exit 254). `denied` lists refusals.
- docker: `build --target context --output type=local` runs the real Docker (BuildKit's context, FAKE_DOCKER_REAL);
  `build -t …` keeps a copy of the built tree as the image; `push` puts it in ECR; `login` reads its token.
- python3: infra/aws/package_api.py writes a stand-in package; the other infra scripts run with the real Python.
- node: the real Node for infra/aws/*.mjs when FAKE_NODE_REAL is set, else a run that passed; npm: nothing.
- gh: `gh api repos/<owner>/<repo>/actions/runs/<run>/attempts/<attempt> --jq .status`, from `github` ("<run>-<attempt>":
  status), else GitHub's 404.

Reviews of 26 Nov 2026 (FAILURE_MODES_OPTIMISATIONS.md GH157.3): two Deploys may share one world (one FAKE_STATE):
every call holds a lock on it; `faults.pause` ({run, call, stack?, when_stack?}) suspends one run (its FAKE_RUN, else
GITHUB_RUN_ID) at one call, before the call does anything, until <FAKE_STATE>.resume exists, as a stopped process would.
CloudFormation: `faults.in_progress` ({stack: n}) shows a stack UPDATE_IN_PROGRESS to its next n status reads and refuses
a change meanwhile; a stack REVIEW_IN_PROGRESS (a creating change set never executed) is created anew by `deploy`;
`faults.deploy` "applied-lost" applies a change then loses the answer (exit 255, no error code), once. The worker stack
registers a task definition revision of vega-v2-migrate for each image its tasks take (`taskdefs`, its output
MigrationTaskDefinition). ECS one-off tasks: RunTask's answer `[tasks[0].taskArn, failures[0].reason]`; `faults.runtask`
(consumed in order, one per request): "refused" (no task, a failure), "lost" (the task created, the answer lost),
"unknown" (nothing done, no answer), "denied" (IAM refuses the call, whatever its token). One invocation of the CLI
sends up to AWS_MAX_ATTEMPTS requests (3 unset, the CLI v2's standard retry mode): after a timeout ("lost", "unknown")
it sends the request again, and only the last answer is the invocation's (counter-review of 06 h 28); each `aws` call
logs AWS_MAX_ATTEMPTS when its environment sets it. `faults.fresh_missing` (n): a migrate task just
created is not visible to DescribeTasks and ListTasks for its next n reads (MISSING); a task definition by revision runs
that revision's image; `startedBy` and `clientToken` are kept (a
request repeated with one token returns its task); `faults.migrate_running` ({"full"|"online": rounds}) keeps a migrate
task RUNNING for that many rounds of the waiter; `faults.list_lag` (n) answers the next n ListTasks by token empty, as
an eventually consistent list; a task marked `missing` answers MISSING; `overlaps` records a migrate task started while
another ran; no worker stack, no cluster. SSM keeps each region's parameters apart (`<region>:<name>` outside the
default region) and deletes. `faults.build_fail`: the image build fails.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

HERE = Path(__file__).resolve()
NAMES = ("aws", "docker", "python3", "node", "npm", "gh")


def install(bin_dir, python=sys.executable):
    """bin/<name> for each tool, each running this file."""
    bin_dir = Path(bin_dir)
    bin_dir.mkdir(parents=True, exist_ok=True)
    for name in NAMES:
        path = bin_dir / name
        path.write_text(f"#!{python}\nimport runpy\nrunpy.run_path({str(HERE)!r}, init_globals={{'TOOL': {name!r}}}, run_name='__main__')\n")
        path.chmod(0o755)
    return bin_dir


# --- the state --------------------------------------------------------------------------------------------------------

def load():
    return json.loads(Path(os.environ["FAKE_STATE"]).read_text())


def save(state):
    path = Path(os.environ["FAKE_STATE"])
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1))
    tmp.replace(path)


def log(tool, argv, **extra):
    with open(os.environ["FAKE_LOG"], "a") as f:
        f.write(json.dumps({"tool": tool, "argv": argv, **extra}) + "\n")


def fail(code, operation, message, exit_code=254):
    print(f"\nAn error occurred ({code}) when calling the {operation} operation: {message}", file=sys.stderr)
    sys.exit(exit_code)


def options(argv):
    words, opts, key = [], {}, None
    for token in argv:
        if token.startswith("--"):
            key = token[2:]
            opts.setdefault(key, [])
        elif key is None:
            words.append(token)
        else:
            opts[key].append(token)
    return words, opts


def value(opts, name, default=""):
    return (opts.get(name) or [default])[0]


def template_keys(path):
    """The parameter keys of a template (its top-level Parameters section)."""
    text = Path(path).read_text()
    section = text.split("\nParameters:\n", 1)[1]
    section = re.split(r"\n(?:Conditions|Resources|Rules|Mappings|Metadata|Outputs):\n", section, maxsplit=1)[0]
    return re.findall(r"^  (\w+):", section, re.M)


# --- the worker stack's services ---------------------------------------------------------------------------------------

def services_after(state, stack, before_params, before_sha):
    """The two services after a change of the worker stack: a new revision when what their task runs changed."""
    params = stack["parameters"]
    now = len(open(os.environ["FAKE_LOG"]).read().splitlines())
    for name, desired_key in (("worker", "DesiredCount"), ("backfill", "BackfillDesiredCount")):
        service = state.setdefault("services", {}).setdefault(name, {"desired": 0, "revision": 0, "starts": 0, "stops": 0,
                                                                       "replacements": 0, "image": None, "timeline": []})
        keys = ["ImageTag", "SecretsRevision"] + (["OddsApiKeyParameter"] if name == "worker" else [])
        fingerprint = [params.get(k, "") for k in keys] + [stack.get("template_sha")]
        old = service.get("fingerprint")
        desired = int(params.get(desired_key) or 0)
        changed = old is not None and old != fingerprint
        if old is None or changed:
            service["revision"] += 1
        if service["desired"] >= 1 and desired >= 1 and changed:
            service["replacements"] += 1
        if service["desired"] >= 1 and desired == 0:
            service["stops"] += 1
        if service["desired"] == 0 and desired >= 1:
            service["starts"] += 1
        service.update(desired=desired, fingerprint=fingerprint, image=params.get("ImageTag"))
        service["timeline"].append([now, desired, params.get("ImageTag")])


def steal(state, owner):
    """Another run takes the Deploy state over while this one is busy: its owner, its beat, a new ETag; the phase, the
    saved counts and the flags kept (FAILURE_MODES_OPTIMISATIONS.md GH157-o, GH157-p)."""
    for objects in state["s3"]["buckets"].values():
        current = objects.get("state.json") or objects.get("deploy/state.json")
        if current:
            doc = json.loads(current["body"])
            doc.update(owner=owner, beat=int(time.time()))
            current["body"] = json.dumps(doc, sort_keys=True)
            current["etag"] = '"' + hashlib.md5((current["body"] + str(time.time_ns())).encode()).hexdigest() + '"'
    log("steal", [owner])
    save(state)


def ssm_key(state, region, name):
    """A parameter of the default region by its name, another region's as `<region>:<name>` (SSM keeps regions apart)."""
    return name if region == state.get("region", "us-east-2") else f"{region}:{name}"


def migrate_revision(state, stack):
    """A task definition revision of vega-v2-migrate for the image the worker stack's tasks take (as ECS registers one
    when the stack changes it): its ARN in the stack's output MigrationTaskDefinition, its image in `taskdefs`."""
    image = stack["parameters"].get("TaskImageTag") or stack["parameters"].get("ImageTag")
    defs = state.setdefault("taskdefs", {})
    latest = stack.setdefault("outputs", {}).get("MigrationTaskDefinition")
    if latest and defs.get(latest) == image:
        return
    arn = f"arn:aws:ecs:us-east-2:{state['account']}:task-definition/vega-v2-migrate:{len(defs) + 1}"
    defs[arn] = image
    stack["outputs"]["MigrationTaskDefinition"] = arn


def timeout(operation):
    """The CLI's end when no answer came (no error code): the call's outcome unknown."""
    print(f"\nRead timeout on endpoint URL: \"https://{operation}.us-east-2.amazonaws.com/\"", file=sys.stderr)
    sys.exit(255)


def pause_point(argv):
    """`faults.pause` ({run, call: [service, op], stack?, when_stack?}): that run (FAKE_RUN, else GITHUB_RUN_ID), at that
    call (once `when_stack` exists, when given), waits as a suspended process would, before the call does anything, until
    the test creates <FAKE_STATE>.resume."""
    world = load()
    pause = world.get("faults", {}).get("pause")
    if not pause or (os.environ.get("FAKE_RUN") or os.environ.get("GITHUB_RUN_ID")) != pause["run"]:
        return
    words, opts = options(argv)
    if words[:2] != pause["call"] or (pause.get("stack") and value(opts, "stack-name") != pause["stack"]):
        return
    if pause.get("when_stack") and pause["when_stack"] not in world.get("stacks", {}):
        return
    log("paused", argv)
    resume = Path(os.environ["FAKE_STATE"] + ".resume")
    for _ in range(6000):
        if resume.exists():
            break
        time.sleep(0.05)
    log("resumed", argv)


# --- aws --------------------------------------------------------------------------------------------------------------

def aws(argv):
    state = load()
    log("aws", argv, **({"max_attempts": os.environ["AWS_MAX_ATTEMPTS"]} if "AWS_MAX_ATTEMPTS" in os.environ else {}))
    words, opts = options(argv)
    service, op = (words + ["", ""])[:2]
    query = value(opts, "query")
    region = value(opts, "region", state.get("region", "us-east-2"))
    denied = set(state.get("denied", []))
    faults = state.setdefault("faults", {})

    def refuse(action, operation):
        if action in denied:
            fail("AccessDeniedException" if service in ("ecr", "ecs", "logs") else "AccessDenied", operation,
                 f"User: arn:aws:sts::{state['account']}:assumed-role/vega-v2-deploy/run is not authorized to perform: {action}")

    if (service, op) == ("sts", "get-caller-identity"):
        if faults.get("sts"):
            fail("ExpiredToken", "GetCallerIdentity", "The security token included in the request is expired")
        print(state["account"])
        return

    if service == "cloudformation":
        name = value(opts, "stack-name")
        stacks = state["stacks"]
        stack = stacks.get(name)
        if op == "describe-stacks":
            refuse(f"cloudformation:DescribeStacks:{name}", "DescribeStacks")
            if stack is None:
                fail("ValidationError", "DescribeStacks", f"Stack with id {name} does not exist")
            if query == "Stacks[0].StackStatus":
                rounds = faults.get("in_progress", {}).get(name, 0)
                if rounds > 0:
                    # An update the dead run submitted, CloudFormation still running it.
                    faults["in_progress"][name] = rounds - 1
                    save(state)
                    log("cfn-status", [name], status="UPDATE_IN_PROGRESS")
                    print("UPDATE_IN_PROGRESS")
                    return
                log("cfn-status", [name], status=stack["status"])
                print(stack["status"])
            elif query == "Stacks[0].Parameters[].ParameterKey":
                print("\t".join(stack.get("keys") or sorted(stack["parameters"])))
            elif m := re.fullmatch(r"Stacks\[0\]\.Outputs\[\?OutputKey=='(\w+)'\]\.OutputValue", query):
                print(stack.get("outputs", {}).get(m[1], ""))
            elif m := re.fullmatch(r"Stacks\[0\]\.Parameters\[\?ParameterKey=='(\w+)'\]\.ParameterValue", query):
                print(stack.get("parameters", {}).get(m[1], ""))
            else:
                fail("FakeError", "DescribeStacks", "unknown query " + query, 99)
            return
        if op == "deploy":
            refuse(f"cloudformation:Deploy:{name}", "CreateChangeSet")
            template = value(opts, "template-file")
            sha = hashlib.sha256(Path(template).read_bytes()).hexdigest()
            if faults.get("in_progress", {}).get(name, 0) > 0:
                fail("ValidationError", "CreateChangeSet", f"Stack:{name} is in UPDATE_IN_PROGRESS state and can not be updated.")
            fault = faults.get("deploy", {}).get(name)
            if fault == "fail" or (fault == "fail-on-new-template" and stack is not None and stack.get("template_sha") != sha):
                # The change set fails and rolls back: the stack as it was.
                fail("ValidationError", "ExecuteChangeSet", f"Failed to create/update the stack {name} (rolled back)", 255)
            # A stack in REVIEW_IN_PROGRESS has never been created: the CLI makes a creating change set on it.
            created = stack is None or stack.get("status") == "REVIEW_IN_PROGRESS"
            if created:
                stacks.pop(name, None)
            stack = stacks.setdefault(name, {"status": "CREATE_COMPLETE", "outputs": {}, "parameters": {}, "region": region})
            if created:
                stack["outputs"].update(state.get("created_outputs", {}).get(name, {}))
            before_params, before_sha = dict(stack["parameters"]), stack.get("template_sha")
            keys = template_keys(template)
            for key in keys:
                stack["parameters"].setdefault(key, "")
            for pair in opts.get("parameter-overrides", []):
                k, _, v = pair.partition("=")
                stack["parameters"][k] = v
            stack.update(keys=keys, template_sha=sha, status="CREATE_COMPLETE" if created else "UPDATE_COMPLETE")
            if name == "vega-v2-account":
                stack["outputs"]["FrontUrl"] = state.get("front_url", "")
            if name == "vega-v2-worker":
                if created:
                    state["s3"]["buckets"].setdefault(f"vega-v2-releases-{state['account']}-{state.get('region', 'us-east-2')}", {})
                    state["ecr"]["repository"] = True
                stack["outputs"]["WorkerTaskDefinition"] = ""
                services_after(state, stack, before_params, before_sha)
                stack["outputs"]["WorkerTaskDefinition"] = (
                    f"arn:aws:ecs:us-east-2:{state['account']}:task-definition/vega-v2-worker:{state['services']['worker']['revision']}")
                stack["outputs"]["BackfillTaskDefinition"] = (
                    f"arn:aws:ecs:us-east-2:{state['account']}:task-definition/vega-v2-backfill:{state['services']['backfill']['revision']}")
                migrate_revision(state, stack)
            save(state)
            if fault == "applied-lost":
                # CloudFormation applied it; the CLI never got the answer (once).
                faults["deploy"].pop(name)
                save(state)
                log("applied-lost", [name])
                timeout("cloudformation")
            return
        if op == "update-stack":
            refuse(f"cloudformation:UpdateStack:{name}", "UpdateStack")
            if stack is None:
                fail("ValidationError", "UpdateStack", f"Stack [{name}] does not exist")
            if "use-previous-template" not in opts:
                fail("FakeError", "UpdateStack", "the fake takes --use-previous-template only", 99)
            given = {}
            for pair in opts.get("parameters", []):
                fields = dict(item.split("=", 1) for item in pair.split(","))
                given[fields["ParameterKey"]] = None if fields.get("UsePreviousValue") == "true" else fields.get("ParameterValue", "")
            new = {}
            reset = []
            for key in stack.get("keys") or stack["parameters"]:
                if key in given:
                    new[key] = stack["parameters"].get(key, "") if given[key] is None else given[key]
                else:
                    new[key] = ""  # CloudFormation takes the template's default for a parameter not given
                    reset.append(key)
            unknown = sorted(set(given) - set(stack.get("keys") or stack["parameters"]))
            if unknown:
                fail("ValidationError", "UpdateStack", f"Parameters: {unknown} do not exist in the template")
            if faults.get("in_progress", {}).get(name, 0) > 0:
                fail("ValidationError", "UpdateStack", f"Stack:{name} is in UPDATE_IN_PROGRESS state and can not be updated.")
            if new == stack["parameters"]:
                fail("ValidationError", "UpdateStack", "No updates are to be performed.")
            if faults.get("update-stack", {}).get(name) == "fail":
                fail("ValidationError", "UpdateStack", "the update failed and rolled back", 255)
            before_params = dict(stack["parameters"])
            stack["parameters"] = new
            stack["status"] = "UPDATE_COMPLETE"
            state.setdefault("resets", []).extend(f"{name}:{k}" for k in reset)
            if name == "vega-v2-worker":
                services_after(state, stack, before_params, stack.get("template_sha"))
                migrate_revision(state, stack)
            save(state)
            hang = faults.get("hang_after_stop")
            if hang and name == "vega-v2-worker" and new.get("DesiredCount") == "0":
                log("hang", [name], seconds=hang)
                time.sleep(hang)
            thief = faults.pop("steal_after_stop", None)
            if thief and name == "vega-v2-worker" and new.get("DesiredCount") == "0":
                steal(state, thief)
            elif thief:
                faults["steal_after_stop"] = thief
                save(state)
            return
        if op == "wait":
            return
        fail("FakeError", "CloudFormation", "unexpected call " + " ".join(argv), 99)

    if service == "ecr":
        repo = state["ecr"]
        if op == "describe-repositories":
            refuse("ecr:DescribeRepositories", "DescribeRepositories")
            if not repo.get("repository"):
                fail("RepositoryNotFoundException", "DescribeRepositories",
                     f"The repository with name 'vega-v2-worker' does not exist in the registry with id '{state['account']}'")
            print("vega-v2-worker")
            return
        if op == "describe-images":
            refuse("ecr:DescribeImages", "DescribeImages")
            if not repo.get("repository"):
                fail("RepositoryNotFoundException", "DescribeImages", "The repository with name 'vega-v2-worker' does not exist")
            tag = value(opts, "image-ids").split("=", 1)[1]
            if tag not in repo.get("images", []):
                fail("ImageNotFoundException", "DescribeImages", f"The image with imageId {{imageTag:'{tag}'}} does not exist within the repository")
            print("sha256:" + hashlib.sha256(tag.encode()).hexdigest())
            return
        if op == "get-login-password":
            refuse("ecr:GetAuthorizationToken", "GetAuthorizationToken")
            if faults.get("login"):
                fail("ExpiredTokenException", "GetAuthorizationToken", "The security token included in the request is expired")
            print("fake-registry-token")
            return
        fail("FakeError", "ECR", "unexpected call " + " ".join(argv), 99)

    if service == "ecs":
        tasks = state.setdefault("tasks", {})
        if op in ("run-task", "list-tasks", "wait", "describe-tasks") and "vega-v2-worker" not in state["stacks"]:
            fail("ClusterNotFoundException", {"run-task": "RunTask", "list-tasks": "ListTasks"}.get(op, "DescribeTasks"), "Cluster not found.")
        if op == "run-task":
            definition = value(opts, "task-definition")
            family = definition.rsplit("/", 1)[-1].split(":")[0]
            refuse(f"ecs:RunTask:{family}", "RunTask")
            answer = lambda arn, reason=None: print(f"{arn}\t{reason or 'None'}" if query.startswith("[") else arn)  # noqa: E731
            token = value(opts, "client-token")
            attempts = int(os.environ.get("AWS_MAX_ATTEMPTS") or 3)
            for attempt in range(1, attempts + 1):
                last = attempt == attempts

                def no_answer(what, arn=None):
                    """A timeout: the invocation's end on its last request, else the CLI sends the request again."""
                    if last:
                        timeout("ecs")
                    log("ecs-cli-retry", [family, token], after=what, **({"arn": arn} if arn else {}))

                outcome = faults.get("runtask", []).pop(0) if family == "vega-v2-migrate" and faults.get("runtask") else "ok"
                save(state)
                if outcome == "unknown":
                    log("ecs-unknown", [family, token])
                    no_answer("unknown")
                    continue
                if outcome == "denied":
                    log("ecs-denied", [family, token])
                    fail("AccessDeniedException", "RunTask", f"User: arn:aws:sts::{state['account']}:assumed-role/vega-v2-deploy/run is not authorized to perform: ecs:RunTask")
                known = next((a for a, t in tasks.items() if token and t.get("clientToken") == token), None)
                if known:
                    # The same request again (its client token): the task it started, no second one (its answer lost again
                    # when the outcome says so).
                    log("ecs-task-again", [family, token], arn=known)
                    if outcome == "lost":
                        no_answer("lost", known)
                        continue
                    answer(known)
                    return
                if outcome == "refused":
                    log("ecs-refused", [family, token])
                    answer("None", "RESOURCE:MEMORY")
                    return
                worker = state["stacks"].get("vega-v2-worker", {}).get("parameters", {})
                image = state.get("taskdefs", {}).get(definition) or worker.get("TaskImageTag") or worker.get("ImageTag")
                arn = f"arn:aws:ecs:us-east-2:{state['account']}:task/vega-v2/{len(tasks) + 1:04d}"
                command = []
                overrides = value(opts, "overrides")
                if overrides:
                    for c in json.loads(overrides).get("containerOverrides", []):
                        command += c.get("command", [])
                running = [a for a, t in tasks.items() if t["family"] == family == "vega-v2-migrate" and t.get("lastStatus") != "STOPPED"]
                if running:
                    state.setdefault("overlaps", []).append({"started": arn, "while": running})
                rounds = faults.get("migrate_running", {}).get("online" if command == ["--online"] else "full", 0) if family == "vega-v2-migrate" else 0
                task = {"family": family, "image": image, "command": command, "exit": None, "stopCode": "EssentialContainerExited",
                        "startedBy": value(opts, "started-by"), "clientToken": token, "rounds": rounds,
                        "lastStatus": "RUNNING" if rounds else "STOPPED",
                        "missing_rounds": faults.get("fresh_missing", 0) if family == "vega-v2-migrate" else 0}
                if family == "vega-v2-migrate":
                    task.update(migrate(state, image, command))
                tasks[arn] = task
                save(state)
                log("ecs-task", [family, image, *command], exit=task["exit"], stopCode=task["stopCode"], output=task.get("output", "")[-600:],
                    arn=arn, lastStatus=task["lastStatus"], startedBy=task["startedBy"], definition=definition)
                if outcome == "lost":
                    log("ecs-lost", [family, token], arn=arn)
                    no_answer("lost", arn)
                    continue
                answer(arn)
                return
        if op == "wait":
            refuse("ecs:DescribeTasks", "DescribeTasks")
            if any(a not in tasks or tasks[a].get("missing") or tasks[a].get("missing_rounds", 0) > 0 for a in opts.get("tasks", [])):
                print("\nWaiter TasksStopped failed: Waiter encountered a terminal failure state: For expression \"failures[].reason\" we matched expected path: \"MISSING\"", file=sys.stderr)
                sys.exit(255)
            pending = [tasks[a] for a in opts.get("tasks", []) if a in tasks and tasks[a].get("lastStatus") == "RUNNING"]
            for task in pending:
                # One round of the waiter: the task runs on through it while it has rounds left.
                task["rounds"] -= 1
                if task["rounds"] <= 0:
                    task["lastStatus"] = "STOPPED"
            save(state)
            if any(t["lastStatus"] == "RUNNING" for t in pending):
                log("ecs-wait", opts.get("tasks", []), result="timeout")
                print("\nWaiter TasksStopped failed: Max attempts exceeded", file=sys.stderr)
                sys.exit(255)
            log("ecs-wait", opts.get("tasks", []), result="stopped")
            return
        if op == "describe-tasks":
            refuse("ecs:DescribeTasks", "DescribeTasks")
            arn = value(opts, "tasks")
            task = tasks.get(arn)
            if query == "[tasks[0].lastStatus,tasks[0].containers[0].exitCode,failures[0].reason]":
                if task is not None and task.get("missing_rounds", 0) > 0:
                    # Just created, not visible yet.
                    task["missing_rounds"] -= 1
                    save(state)
                    log("ecs-missing-fresh", [arn])
                    print("None\tNone\tMISSING")
                elif task is None or task.get("missing"):
                    print("None\tNone\tMISSING")
                else:
                    stopped = task.get("lastStatus", "STOPPED") == "STOPPED"
                    print(f"{task.get('lastStatus', 'STOPPED')}\t{task['exit'] if stopped and task['exit'] is not None else 'None'}\tNone")
            elif query == "tasks[0].containers[0].exitCode":
                print("None" if task is None or task["exit"] is None or task.get("lastStatus") == "RUNNING" else task["exit"])
            elif query == "tasks[0].[lastStatus,containers[0].exitCode]":
                if task is None:
                    print("None")
                else:
                    stopped = task.get("lastStatus", "STOPPED") == "STOPPED"
                    print(f"{task.get('lastStatus', 'STOPPED')}\t{task['exit'] if stopped and task['exit'] is not None else 'None'}")
            else:
                fail("FakeError", "DescribeTasks", "unknown query " + query, 99)
            return
        if op == "list-tasks":
            refuse("ecs:ListTasks", "ListTasks")
            if value(opts, "started-by") and faults.get("list_lag", 0) > 0:
                # An eventually consistent list: a task just started is not in it yet.
                faults["list_lag"] -= 1
                save(state)
                log("ecs-list-lag", [value(opts, "started-by")])
                print("None")
                return
            wanted = value(opts, "desired-status", "RUNNING")
            found = [a for a, t in tasks.items() if not t.get("missing") and t.get("missing_rounds", 0) <= 0
                     and (not value(opts, "started-by") or t.get("startedBy") == value(opts, "started-by"))
                     and (not value(opts, "family") or t["family"] == value(opts, "family"))
                     and (t.get("lastStatus", "STOPPED") == "STOPPED") == (wanted == "STOPPED")]
            print("\t".join(found) if found else "None")
            return
        if op == "describe-services" and value(opts, "output") == "json" and not query:
            refuse("ecs:DescribeServices", "DescribeServices")
            found = []
            for name in opts.get("services", []):
                key = {"vega-v2-worker": "worker", "vega-v2-backfill": "backfill"}[name]
                s = state.get("services", {}).get(key)
                if s is None:
                    continue
                running = state.get("running", {}).get(key, s["desired"])
                revision = state.get("primary_revision", {}).get(key, s["revision"])
                found.append({"serviceName": name, "desiredCount": s["desired"], "runningCount": running, "deployments": [
                    {"status": "PRIMARY", "taskDefinition": f"arn:aws:ecs:us-east-2:{state['account']}:task-definition/{name}:{revision}", "rolloutState": "COMPLETED"}]})
            print(json.dumps({"services": found, "failures": []}))
            return
        if op == "describe-services":
            refuse("ecs:DescribeServices", "DescribeServices")
            out = []
            for name in opts.get("services", []):
                key = {"vega-v2-worker": "worker", "vega-v2-backfill": "backfill"}[name]
                s = state.get("services", {}).get(key, {"desired": 0, "revision": 0})
                running = state.get("running", {}).get(key, s["desired"])
                revision = state.get("primary_revision", {}).get(key, s["revision"])
                family = name
                out.append("\t".join([name, str(s["desired"]), str(running), "1",
                                      f"arn:aws:ecs:us-east-2:{state['account']}:task-definition/{family}:{revision}", "COMPLETED"]))
            print("\n".join(out))
            return
        fail("FakeError", "ECS", "unexpected call " + " ".join(argv), 99)

    if service == "ssm":
        name = value(opts, "name")
        key = ssm_key(state, region, name)
        if op == "get-parameter":
            refuse(f"ssm:GetParameter:{name}", "GetParameter")
            param = state["params"].get(key)
            if param is None:
                fail("ParameterNotFound", "GetParameter", f"Parameter {name} not found.")
            if query == "Parameter.Value":
                secure = param["Type"] == "SecureString" and "with-decryption" not in opts
                print("AQICAHhCiphertextOfASecureString==" if secure else param["Value"])
            elif query == "Parameter.Name":
                print(name)
            elif query == "Parameter.Type":
                print(param["Type"])
            elif query == "[Parameter.Version,Parameter.LastModifiedDate]":
                print(f"{param.get('Version', 1)}\t{param.get('LastModifiedDate', '2026-11-20T10:00:00.000000+00:00')}")
            elif query == "":
                print(json.dumps({"Parameter": {"Name": name, "Type": param["Type"]}}))
            else:
                fail("FakeError", "GetParameter", "unknown query " + query, 99)
            return
        if op == "put-parameter":
            refuse(f"ssm:PutParameter:{name}", "PutParameter")
            given = value(opts, "value")
            if key in state["params"] and "overwrite" not in opts:
                fail("ParameterAlreadyExists", "PutParameter", "The parameter already exists. To overwrite this value, set the overwrite option in the request to true.")
            if given.startswith("file://"):
                given = open(given[len("file://"):]).read()
            version = state["params"].get(key, {}).get("Version", 0) + 1
            state["params"][key] = {"Type": value(opts, "type"), "Value": given, "Version": version,
                                    "LastModifiedDate": f"2026-11-26T00:00:{version:02d}.000000+00:00"}
            save(state)
            print(json.dumps({"Version": version, "Tier": "Standard"}))
            return
        if op == "delete-parameter":
            refuse(f"ssm:DeleteParameter:{name}", "DeleteParameter")
            if key not in state["params"]:
                fail("ParameterNotFound", "DeleteParameter", f"Parameter {name} not found.")
            del state["params"][key]
            save(state)
            return
        fail("FakeError", "SSM", "unexpected call " + " ".join(argv), 99)

    if (service, op) == ("s3", "cp"):
        if not os.path.isfile(words[2]):
            fail("FakeError", "PutObject", "no file " + words[2], 1)
        return

    if service == "s3api":
        buckets = state["s3"]["buckets"]
        bucket, key = value(opts, "bucket"), value(opts, "key")
        if op == "head-bucket":
            refuse(f"s3:ListBucket:{bucket}", "HeadBucket")
            if bucket not in buckets:
                fail("404", "HeadBucket", "Not Found")
            print("{}")
            return
        if op == "put-object":
            refuse(f"s3:PutObject:{key}", "PutObject")
            if bucket not in buckets:
                fail("NoSuchBucket", "PutObject", "The specified bucket does not exist")
            body = Path(value(opts, "body")).read_text()
            log("s3-body", [bucket, key], body=body)
            current = buckets[bucket].get(key)
            if "if-match" in opts and current is not None and faults.get("s3_race", 0) > 0:
                # Another run writes the object between this one's read and its write.
                faults["s3_race"] -= 1
                current["etag"] = '"another-run"'
                save(state)
            if "if-none-match" in opts and current is not None:
                fail("PreconditionFailed", "PutObject", "At least one of the pre-conditions you specified did not hold")
            if "if-match" in opts:
                if current is None:
                    fail("NoSuchKey", "PutObject", "The specified key does not exist.")
                if current["etag"] != value(opts, "if-match"):
                    fail("PreconditionFailed", "PutObject", "At least one of the pre-conditions you specified did not hold")
            etag = '"' + hashlib.md5((body + str(time.time_ns())).encode()).hexdigest() + '"'
            buckets[bucket][key] = {"body": body, "etag": etag}
            save(state)
            print(json.dumps({"ETag": etag}))
            return
        if op == "get-object":
            refuse(f"s3:GetObject:{key}", "GetObject")
            if bucket not in buckets:
                fail("NoSuchBucket", "GetObject", "The specified bucket does not exist")
            current = buckets[bucket].get(key)
            if current is None:
                fail("NoSuchKey", "GetObject", "The specified key does not exist.")
            # The outfile is the command's one positional argument, wherever it stands.
            outfile = words[2] if len(words) > 2 else opts["key"][1]
            Path(outfile).write_text(current["body"])
            print(json.dumps({"ETag": current["etag"]}))
            return
        fail("FakeError", "S3", "unexpected call " + " ".join(argv), 99)

    fail("FakeError", service or "aws", "unexpected call " + " ".join(argv), 99)


def migrate(state, image, command):
    """The migrate task: the image's own tree, its real `python -m vega.migrate` on the test base."""
    tree = state.get("images", {}).get(image)
    if not tree or image not in state["ecr"].get("images", []):
        # ECS cannot pull the image: the task stops before its container starts (no exit code).
        return {"exit": None, "stopCode": "TaskFailedToStart", "output": f"CannotPullContainerError: {image} not found"}
    script = state.get("migrate", {}).get("script")
    if script:
        code = script.pop(0)
        return {"exit": code, "output": "scripted", **({"stopCode": "TaskFailedToStart"} if code is None else {})}
    if "default" in state.get("migrate", {}):
        return {"exit": state["migrate"]["default"], "output": "scripted"}
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PYTHONPATH": str(Path(tree) / "backend"),
           "V2_MIGRATION_DATABASE_URL": state["migrate"]["dsn"]}
    worker = state["stacks"].get("vega-v2-worker", {}).get("parameters", {})
    for role in ("collect", "calc", "read") + (("account",) if worker.get("Account") == "true" else ()):
        param = state["params"].get(f"/vega/v2/password-{role}")
        if param:
            env[f"V2_{role.upper()}_PASSWORD"] = param["Value"]
    done = subprocess.run([state["python"], "-m", "vega.migrate", *command], cwd=Path(tree) / "backend", env=env,
                          capture_output=True, text=True, timeout=600)
    return {"exit": done.returncode, "output": done.stdout + done.stderr}


# --- docker, python3, node, npm ---------------------------------------------------------------------------------------

def docker(argv):
    state = load()
    log("docker", argv, cwd=os.getcwd())
    words, opts = options(argv)
    command = words[0] if words else (argv[0] if argv else "")
    if argv[:1] == ["login"]:
        # Its token was read before the lock (__main__): the aws that writes it holds the lock meanwhile.
        if state.get("faults", {}).get("docker_login"):
            print("Error response from daemon: login attempt failed", file=sys.stderr)
            sys.exit(1)
        return
    if argv[:1] == ["build"] and "--target" in argv and argv[argv.index("--target") + 1] == "context":
        real = os.environ.get("FAKE_DOCKER_REAL")
        if real:
            os.execv(real, [real, *argv])
        dest = Path(next(o for o in argv if o.startswith("type=local,dest=")).split("dest=", 1)[1])
        (dest / "backend").mkdir(parents=True, exist_ok=True)
        (dest / "backend" / "context.txt").write_text(state.get("context", "a fixed context\n"))
        return
    if argv[:1] == ["build"]:
        if state.get("faults", {}).get("build_fail"):
            print("ERROR: failed to solve: process \"/bin/sh -c pip install\" did not complete successfully: exit code: 1", file=sys.stderr)
            sys.exit(1)
        tag = argv[argv.index("-t") + 1].rsplit(":", 1)[1]
        store = Path(state["images_dir"]) / tag
        if store.exists():
            shutil.rmtree(store)
        shutil.copytree(Path(os.getcwd()) / "backend", store / "backend", ignore=shutil.ignore_patterns("__pycache__", "node_modules", "tests"))
        state.setdefault("images", {})[tag] = str(store)
        state.setdefault("built", []).append(tag)
        save(state)
        return
    if argv[:1] == ["push"]:
        thief = state.get("faults", {}).pop("steal_on_push", None)
        if thief:
            steal(state, thief)
        tag = argv[1].rsplit(":", 1)[1]
        if tag not in state.get("images", {}):
            print(f"An image does not exist locally with the tag: {argv[1]}", file=sys.stderr)
            sys.exit(1)
        if tag in state["ecr"].setdefault("images", []):
            print(f"tag invalid: The image tag '{tag}' already exists in the 'vega-v2-worker' repository and cannot be overwritten "
                  "because the repository is immutable.", file=sys.stderr)
            sys.exit(1)
        state["ecr"]["images"].append(tag)
        state.setdefault("pushed", []).append(tag)
        save(state)
        return
    print("fake docker: unexpected call " + " ".join(argv), file=sys.stderr)
    sys.exit(99)


def python3(argv):
    log("python3", argv)
    if argv[:1] == ["infra/aws/package_api.py"]:
        kind = argv[2] if len(argv) > 2 else "api"
        os.makedirs(argv[1], exist_ok=True)
        path = os.path.join(argv[1], hashlib.sha256(kind.encode()).hexdigest() + ".zip")
        open(path, "w").write(kind)
        print(path)
        return
    if argv[:1] and argv[0].startswith("infra/aws/") and argv[0].endswith(".py"):
        real = os.environ["FAKE_PYTHON_REAL"]
        os.execv(real, [real, *argv])
    sys.exit(99)


def node(argv):
    log("node", argv)
    script = argv[0] if argv else ""
    # FAKE_NODE_REAL runs step 12's probe for real (GH220-s), FAKE_NODE_VERIFY_REAL step 11b's checks (GH202);
    # FAKE_NODE_FAIL names a script that fails (exit 1); any other run passed.
    if script == os.environ.get("FAKE_NODE_FAIL"):
        print(f"fake node: {script} failed", file=sys.stderr)
        sys.exit(1)
    real = {"infra/aws/smoke-favourites.mjs": os.environ.get("FAKE_NODE_REAL"),
            "infra/aws/verify-deploy.mjs": os.environ.get("FAKE_NODE_VERIFY_REAL")}.get(script)
    if real:
        os.execv(real, [real, *argv])
    sys.exit(0)


def npm(argv):
    log("npm", argv)


def gh(argv):
    """GitHub's answer about a run's attempt (`github`: "<run>-<attempt>" → status), else its 404."""
    state = load()
    log("gh", argv)
    m = re.fullmatch(r"repos/[^/]+/[^/]+/actions/runs/(\d+)/attempts/(\d+)", argv[1] if argv[:1] == ["api"] and len(argv) > 1 else "")
    status = state.get("github", {}).get(f"{m[1]}-{m[2]}") if m else None
    if status is None:
        print("gh: Not Found (HTTP 404)", file=sys.stderr)
        sys.exit(1)
    print(status if "--jq" in argv and argv[argv.index("--jq") + 1:][:1] == [".status"] else json.dumps({"status": status}))


if __name__ == "__main__":
    tool = globals().get("TOOL") or os.path.basename(sys.argv[0])
    if tool == "aws":
        pause_point(sys.argv[1:])
    # A tool fed by another's output reads it before taking the lock (`aws ecr get-login-password | docker login`: the
    # aws holds the lock while it writes the token).
    if tool == "docker" and sys.argv[1:2] == ["login"]:
        sys.stdin.read()
    # One call at a time in one world (two Deploys may share it); a tool that hands over to a real program releases it
    # then (the lock's descriptor is not inherited).
    with open(os.environ["FAKE_STATE"] + ".lock", "a") as held:
        fcntl.flock(held, fcntl.LOCK_EX)
        {"aws": aws, "docker": docker, "python3": python3, "node": node, "npm": npm, "gh": gh}[tool](sys.argv[1:])
