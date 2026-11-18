"""Compare the dated author workbook with the RDS provider/edition census without fuzzy joins."""
import csv
import gzip
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import openpyxl

base = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).resolve().parent
base.mkdir(parents=True,exist_ok=True)
instant = sys.argv[4] if len(sys.argv) > 4 else '2026-11-18T15:59:30Z'
xlsx = Path(sys.argv[1])
census = Path(sys.argv[2])
sources = {"PitchAPI":"pitchapi","OpenFootball":"openfootball","Open Matchday":"open_matchday",
           "OpenLigaDB":"openligadb","International Results":"international_results",
           "footballcsv":"footballcsv","engsoccerdata":"engsoccerdata","World Club Ratings":"worldclub"}
with gzip.open(census, "rt", encoding="utf8") as stream:
    editions = list(csv.DictReader(stream))
book = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
result = []
summary = {}
for sheet, source in sources.items():
    cells = list(book[sheet].values)
    assert cells[6][0] == "Competition" and cells[6][6] == "Match rows"
    stats = Counter()
    for index, line in enumerate(cells[7:],8):
        name, country, term, scope, key = line[:5]
        if not name:
            continue
        candidates = [r for r in editions if r["match_provider"] == source]
        wanted = str(term)
        selection = []
        for r in candidates:
            if wanted not in (r["native_label"], r["season"]):
                continue
            alias = str(key).split(" / ")[-1]
            archive = bool(r["archive_key"]) and r["archive_key"] == key
            cup = bool(r["cup_key"]) and alias in r["cup_key"].split(":")[1:-1]
            native = r["competition"] == name and (r["country_code"] == country or not r["country_code"])
            if archive or cup or native:
                selection.append(r)
        actual = selection[0] if len(selection) == 1 else {}
        published = line[6:8]
        state = "non rapprochée" if not selection else "ambiguë" if len(selection)>1 else "sans mesure comparable"
        if actual and all(isinstance(n,int) for n in published):
            state = "identique" if tuple(int(actual[k]) for k in ("recorded_matches","recorded_finished")) == published else "écart de comptage à qualifier"
        stats[state] += 1
        result.append((sheet,index,name,term,key,*published,actual.get("edition_id"),actual.get("recorded_matches"),actual.get("recorded_finished"),state))
    summary[sheet] = dict(stats)
matched = [row[7] for row in result if row[7]]
assert len(set(matched)) == len(matched), "Des lignes du classeur ont été rapprochées de la même édition"
with (base/"comparaison-par-ligne.csv").open("w", encoding="utf8", newline="") as stream:
    writer=csv.writer(stream,lineterminator="\n")
    writer.writerow(("feuille","ligne","compétition","édition","clé","matchs_classeur","terminés_ou_collectés_classeur","id_édition_rds","matchs_rds","terminés_rds","rapprochement"))
    writer.writerows(result)
metadata={"classeur_sha256":hashlib.sha256(xlsx.read_bytes()).hexdigest(),"recensement_sha256":hashlib.sha256(census.read_bytes()).hexdigest(),"revision_classeur":list(book["Evidence"].values)[2][0],"instant_rds":instant,"lignes":len(result),"editions_rds_distinctes_rapprochees":len(set(matched)),"feuilles":len(book.sheetnames),"comparaison":summary}
(base/"synthese.json").write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+"\n")
print(json.dumps(metadata,ensure_ascii=False))
