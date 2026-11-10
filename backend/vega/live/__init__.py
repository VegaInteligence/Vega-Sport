"""Live (doc "Live"): a provider feed per match in progress, stored outside core
(DynamoDB), broadcast by AppSync Events, read at GET /live/matches/{id}, and handed over
to core family by family once PitchAPI has the match. See ingestor.py."""
