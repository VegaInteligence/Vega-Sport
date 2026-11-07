"""Emit the disposable Paris probe stack. Delete the stack after acceptance."""
import json
from pathlib import Path

name = "vega-http-acceptance-20261107"
template = {
    "AWSTemplateFormatVersion": "2010-09-09",
    "Description": "Temporary bounded public HTTP acceptance probe; no database or AWS data access",
    "Resources": {
        "Logs": {"Type": "AWS::Logs::LogGroup", "Properties": {
            "LogGroupName": "/aws/lambda/" + name, "RetentionInDays": 1}},
        "Role": {"Type": "AWS::IAM::Role", "Properties": {
            "AssumeRolePolicyDocument": {"Version": "2012-10-17", "Statement": [{
                "Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"},
                "Action": "sts:AssumeRole"}]},
            "Policies": [{"PolicyName": "OnlyOwnLogs", "PolicyDocument": {
                "Version": "2012-10-17", "Statement": [{"Effect": "Allow",
                    "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
                    "Resource": {"Fn::GetAtt": ["Logs", "Arn"]}}]}}]}},
        "Probe": {"Type": "AWS::Lambda::Function", "Properties": {
            "FunctionName": name, "Description": "Disposable public GET latency probe for audit acceptance",
            "Runtime": "python3.13", "Architectures": ["arm64"], "Handler": "index.handler",
            "MemorySize": 512, "Timeout": 120,
            "Role": {"Fn::GetAtt": ["Role", "Arn"]},
            "Code": {"ZipFile": Path(__file__).with_name("probe.py").read_text()},
            "Tags": [{"Key": "Project", "Value": "Vega-Sport"},
                     {"Key": "Purpose", "Value": "temporary-audit-acceptance"}]}},
    },
    "Outputs": {"FunctionName": {"Value": {"Ref": "Probe"}}},
}
print(json.dumps(template))
