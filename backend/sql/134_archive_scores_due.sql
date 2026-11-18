-- The open-cups reader now reads a score the source writes as a bare pair (cups.READER 2): OpenFootball's World Cup
-- files of 1950 to 2014 write a match decided in ninety minutes "score": [a, b], and 666 of the 1,069 archived World
-- Cup matches had no score (18 November 2026: the 1998 final among them). An edition is read again once, its content
-- unchanged, when its scope is next due: a week at most for a finished one. They are due at the worker's next round.
UPDATE ops.source_runs SET last_success_at = NULL WHERE source = 'openfootball' AND scope LIKE 'open-cups:%';
