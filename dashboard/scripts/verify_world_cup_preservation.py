#!/usr/bin/env python3
"""Check that World Cup import did not alter previously captured table bytes."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];out=ROOT/'dashboard/outputs/pitchapi-coverage';refs=json.loads((out/'before-world-cup.json').read_text());bad=[p for p,h in refs.items() if hashlib.sha256((ROOT/'data'/p).read_bytes()).hexdigest()!=h]
report={'setup':'Canonical table SHA-256 values recorded after GitHub refresh, immediately before World Cup import.','command':'python3 dashboard/scripts/verify_world_cup_preservation.py','expected':'All pre-existing canonical table bytes remain unchanged.','actual':{'files_checked':len(refs),'changed_files':bad},'status':'passed' if not bad else 'failed'};(out/'world-cup-preservation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));assert not bad
