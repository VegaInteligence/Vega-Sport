"""Create/update the v2-only CI role; no instance, storage or plan changes."""

import json
import sys
from shared_ops import aws, infrastructure, OperatorError

ROLE = "VegaV2GitHubIngest"
ACCOUNT = "361769570630"
POLICY = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": "ssm:GetParameter",
            "Resource": f"arn:aws:ssm:us-east-2:{ACCOUNT}:parameter/statarena/v2/ingest",
        },
        {
            "Effect": "Allow",
            "Action": "cloudwatch:GetMetricStatistics",
            "Resource": "*",
            "Condition": {"StringEquals": {"aws:RequestedRegion": "us-east-2"}},
        },
        {
            "Effect": "Allow",
            "Action": ["ec2:DescribeSecurityGroups", "ec2:DescribeSecurityGroupRules"],
            "Resource": "*",
            "Condition": {"StringEquals": {"aws:RequestedRegion": "us-east-2"}},
        },
        {
            "Effect": "Allow",
            "Action": [
                "ec2:AuthorizeSecurityGroupIngress",
                "ec2:RevokeSecurityGroupIngress",
            ],
            "Resource": f"arn:aws:ec2:us-east-2:{ACCOUNT}:security-group/sg-0667c20e8ff5d2431",
        },
        {
            "Effect": "Allow",
            "Action": "ec2:AuthorizeSecurityGroupIngress",
            "Resource": f"arn:aws:ec2:us-east-2:{ACCOUNT}:security-group-rule/*",
            "Condition": {
                "StringEquals": {"aws:RequestTag/ManagedBy": "statarena-actions"},
                "ForAllValues:StringEquals": {"aws:TagKeys": ["ManagedBy"]},
            },
        },
        {
            "Effect": "Allow",
            "Action": "ec2:CreateTags",
            "Resource": f"arn:aws:ec2:us-east-2:{ACCOUNT}:security-group-rule/*",
            "Condition": {
                "StringEquals": {
                    "ec2:CreateAction": "AuthorizeSecurityGroupIngress",
                    "aws:RequestTag/ManagedBy": "statarena-actions",
                }
            },
        },
    ],
}
TRUST = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Federated": f"arn:aws:iam::{ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                    "token.actions.githubusercontent.com:repository_id": "1441213700",
                    "token.actions.githubusercontent.com:workflow": "Vega v2 collection (existing RDS)",
                    "token.actions.githubusercontent.com:sub": [
                        "repo:VegaInteligence@188998341/Vega-Sport@1441213700:ref:refs/heads/main",
                        "repo:VegaInteligence@188998341/Vega-Sport@1441213700:ref:refs/heads/codex/vega-v2-rollout-20261108",
                    ],
                }
            },
        }
    ],
}


def main():
    try:
        infrastructure()
        role = aws("iam", "get-role", "--role-name", ROLE, absent="NoSuchEntity")
        if role:
            if {tag["Key"]: tag["Value"] for tag in role["Role"].get("Tags", [])}.get(
                "Application"
            ) != "vega-v2":
                raise OperatorError("UNOWNED_ROLE")
            aws(
                "iam",
                "update-assume-role-policy",
                body={"RoleName": ROLE, "PolicyDocument": json.dumps(TRUST)},
            )
        else:
            aws(
                "iam",
                "create-role",
                body={
                    "RoleName": ROLE,
                    "AssumeRolePolicyDocument": json.dumps(TRUST),
                    "MaxSessionDuration": 21600,
                    "Tags": [{"Key": "Application", "Value": "vega-v2"}],
                },
            )
        aws(
            "iam",
            "put-role-policy",
            body={
                "RoleName": ROLE,
                "PolicyName": "VegaV2ExistingRdsOnly",
                "PolicyDocument": json.dumps(POLICY),
            },
        )
        print(
            json.dumps(
                {"role": f"arn:aws:iam::{ACCOUNT}:role/{ROLE}", "new_compute": False}
            )
        )
        return 0
    except Exception as error:
        print(
            json.dumps(
                {
                    "error": (
                        str(error)
                        if isinstance(error, OperatorError)
                        else type(error).__name__
                    )
                }
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
