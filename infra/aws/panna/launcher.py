"""Lambda control plane only, never receives source data or SQL credentials."""
import json
import os
import re
import time

import boto3

CLUSTER = "vega-v2"
PURPOSE = "PannaDailyBridge"
ecs = boto3.client("ecs")


def tasks_for(key):
    # The only filter allowed alongside startedBy is cluster, per the ECS API.
    found = ecs.list_tasks(cluster=CLUSTER, startedBy=key)["taskArns"]
    if not found:
        return []
    response = ecs.describe_tasks(cluster=CLUSTER, tasks=found, include=["TAGS"])
    if response["failures"] or len(response["tasks"]) != len(found):
        raise RuntimeError("TASK_LOOKUP_FAILED")
    tasks = response["tasks"]
    if any(t["startedBy"] != key or not t["taskDefinitionArn"].split("/")[-1].startswith("vega-v2-panna-daily-bridge:")
           or {"key": "VegaPurpose", "value": PURPOSE} not in t.get("tags", []) for t in tasks):
        raise RuntimeError("TASK_OWNERSHIP_MISMATCH")
    return tasks


def launch(key):
    started = ecs.run_task(cluster=CLUSTER, taskDefinition=os.environ["TASK_DEFINITION"], launchType="FARGATE",
                           count=1, enableExecuteCommand=True, clientToken=key, startedBy=key,
                           networkConfiguration=json.loads(os.environ["BRIDGE_NETWORK"]),
                           tags=[{"key": "VegaPurpose", "value": PURPOSE}])
    if started["failures"] or len(started["tasks"]) != 1:
        raise RuntimeError("TASK_START_FAILED")
    arn = started["tasks"][0]["taskArn"]
    for _ in range(25):
        pending = ecs.describe_tasks(cluster=CLUSTER, tasks=[arn])["tasks"]
        if not pending:
            time.sleep(3)
            continue
        task, = pending
        containers = [c for c in task["containers"] if c["name"] == "bridge"]
        if not containers:
            time.sleep(3)
            continue
        container, = containers
        if task["lastStatus"] == "STOPPED":
            break
        if task["lastStatus"] == "RUNNING" and any(
            agent["name"] == "ExecuteCommandAgent" and agent["lastStatus"] == "RUNNING"
            for agent in container.get("managedAgents", [])
        ):
            return {"ok": True, "target": f"ecs:{CLUSTER}_{arn.split('/')[-1]}_{container['runtimeId']}"}
        time.sleep(3)
    raise RuntimeError("TASK_UNREADY")


def cleanup(key):
    # Retest absence because RunTask and ListTasks are eventually consistent.
    tasks = []
    for attempt in range(4):
        tasks = tasks_for(key)
        if tasks:
            break
        if attempt != 3:
            time.sleep(3)
    for task in tasks:
        if task["desiredStatus"] != "STOPPED":
            ecs.stop_task(cluster=CLUSTER, task=task["taskArn"], reason="Bounded PannaData SQL transport complete")
    if tasks:
        ecs.get_waiter("tasks_stopped").wait(cluster=CLUSTER, tasks=[task["taskArn"] for task in tasks],
                                             WaiterConfig={"Delay": 3, "MaxAttempts": 24})
    return {"ok": True, "state": "STOPPED" if tasks else "NO_ACTIVE_TASK_SEEN"}


def handler(event, _context):
    if set(event) != {"action", "run_key"} or not re.fullmatch(r"panna-[0-9]{1,20}-[0-9]{1,6}", event["run_key"]):
        raise RuntimeError("INVALID_BRIDGE_REQUEST")
    if event["action"] == "start":
        return launch(event["run_key"])
    if event["action"] == "cleanup":
        return cleanup(event["run_key"])
    raise RuntimeError("INVALID_BRIDGE_OPERATION")
