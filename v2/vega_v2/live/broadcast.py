"""Broadcast of live changes (doc "Diffusion": AppSync Events, channel /live/match/{id}).

Only the ingestor publishes, signed with its task role (IAM); browsers subscribe with the
public API key and read the full state from GET /live/matches/{id} (CloudFront, 2 s).
"""

import json
import urllib.request


def channel(match):
    """/live/match/{id}; AppSync channel segments take letters, digits and dashes only, so
    the id's underscore is written as a dash (m_2fkSwK -> m-2fkSwK)."""
    return f"/live/match/{match.replace('_', '-')}"


class MemoryPublisher:
    def __init__(self):
        self.sent = []

    def publish(self, match, events):
        self.sent.append((channel(match), [dict(e) for e in events]))


class AppSyncPublisher:
    """POST https://<http domain>/event, SigV4 (service appsync) with the task's credentials."""

    def __init__(self, http_domain, region, session=None, opener=None):
        import boto3

        self.url = f"https://{http_domain}/event"
        self.region = region
        self.session = session or boto3.Session()
        self.opener = opener or urllib.request.urlopen

    def request(self, match, events):
        from botocore.auth import SigV4Auth
        from botocore.awsrequest import AWSRequest

        body = json.dumps({"channel": channel(match), "events": [json.dumps(e, separators=(",", ":")) for e in events]})
        request = AWSRequest(method="POST", url=self.url, data=body, headers={"Content-Type": "application/json"})
        SigV4Auth(self.session.get_credentials().get_frozen_credentials(), "appsync", self.region).add_auth(request)
        return urllib.request.Request(self.url, data=body.encode(), headers=dict(request.headers.items()), method="POST")

    def publish(self, match, events):
        if not events:
            return
        # AppSync Events takes at most 5 events per publish request.
        for i in range(0, len(events), 5):
            with self.opener(self.request(match, events[i:i + 5]), timeout=10) as response:
                if response.status != 200:
                    raise RuntimeError(f"appsync publish {response.status}")
