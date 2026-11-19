"""Samples of football-data.co.uk's season files (vega/sources/footballdata.py), as the real files are written:
a header naming the columns the season has, dates as dd/mm/yy (dd/mm/yyyy from 2017/18), blank lines at the end,
some files in Latin-1, a byte-order mark, a header with trailing empty columns, rows shorter or longer than it."""

import hashlib

# Ligue 1 2010/11: match statistics, Bet365 and Betbrain's average and maximum, two-digit years, a blank line,
# trailing empty header columns, a row longer than the header (the values past it are not read).
F1_1011 = (
    "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HTR,HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR,"
    "B365H,B365D,B365A,BbMxH,BbMxD,BbMxA,BbAvH,BbAvD,BbAvA,,\r\n"
    "F1,07/08/10,Lyon,Monaco,0,0,D,0,0,D,14,9,5,2,12,15,8,3,1,2,0,0,1.5,4,6.5,1.55,4.2,7,1.5,3.9,6.2,,\r\n"
    "F1,08/08/10,Paris SG,St Etienne,3,1,H,1,1,D,17,8,9,3,10,14,7,2,0,3,0,1,1.8,3.5,4.5,1.85,3.6,4.8,1.78,3.45,4.4,,,9,9\r\n"
    "F1,14/08/10,Monaco,Paris SG,2,2,D,1,0,H,,,,,,,,,,,,,1,3.2,2.4,,,,,,,,\r\n"
    ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,\r\n"
)
# Ligue 1 2011/12: the reverse fixture, four-digit years, the Pinnacle and market columns of later files, a short row.
F1_1112 = (
    "﻿Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HTR,Referee,HS,AS,HST,AST,HC,AC,HY,AY,HR,AR,"
    "PSH,PSD,PSA,PSCH,PSCD,PSCA,AvgH,AvgD,AvgA,MaxH,MaxD,MaxA,BbAvH,BbAvD,BbAvA\n"
    "F1,06/08/2011,20:00,Monaco,Lyon,1,2,A,0,1,A,A Bonnet,10,13,3,6,4,6,2,1,0,0,3.1,3.3,2.4,3,3.4,2.45,3,3.25,2.35,3.2,3.4,2.5,2.9,3.2,2.3\n"
    "F1,07/08/2011,17:00,St Etienne,Paris SG,0,1,A,0,0,D\n"
    "\n"
)
# Eredivisie 2010/11, in Latin-1: a club written with an accent, results and odds only (no statistics).
N1_1011 = (
    "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HTR,B365H,B365D,B365A\r\n"
    "N1,14/08/10,Héracles,Ajax,0,1,A,0,0,D,5,4,1.6\r\n"
    "N1,15/08/10,Feyenoord,Utrecht,2,2,D,2,1,H,1.9,3.4,4\r\n"
)
TEXTS = {"F1/1011": F1_1011, "F1/1112": F1_1112, "N1/1011": N1_1011}
ENCODINGS = {"N1/1011": "latin-1"}


def files(texts=None, encodings=None):
    """{file key: bytes} as the site serves them."""
    texts, encodings = TEXTS if texts is None else texts, ENCODINGS if encodings is None else encodings
    return {key: text.encode(encodings.get(key, "utf-8")) for key, text in texts.items()}


def digests(found):
    return {key: hashlib.sha256(body).hexdigest() for key, body in found.items()}
