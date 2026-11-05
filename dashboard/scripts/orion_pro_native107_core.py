"""Offline materialization of the separately approved six-field017 extension."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from orion_pro_native107_schema import MODEL as MODEL016, MIGRATION as MIGRATION016, ROOT, encoded, require, sha
from orion_pro_native107_delta import check, column, column_comment, compile_migration
from orion_pro_schema import relation

REVIEW = ROOT/'docs/verification/orion-pro-match-core-fields-20261105'
BASE_SHA = 'f516804f6e2381b5e55763860b6470127b88a567006973afa79c0a9f5f0d9ae3'
MODEL017 = MODEL016.with_name('target-schema.approved-107-core.json')
MIGRATION017 = MIGRATION016.with_name('017_orion_pro_native_match_core_fields.sql')
PARENT016_SHA = '12d63eaab6f4d610de3f2ff4efc0dcd71059c4d2e489a5f30d62d2a8498fd087'
TABLE = 'football.match_observation_details'
TRANSFORM = 'orion_pro_publish_native107_core_v1'
METRICS = 'orion_pro_native107_core_v1'
FIELDS = (
    ('source_referee_label','source_referee_state','text','Exact source referee label'),
    ('source_has_playoff','source_has_playoff_state','boolean','Exact source playoff indicator'),
    ('source_league_image_url','source_league_image_url_state','text','Exact observed league image URL; independent of media delivery'),
)


def materialize():
    require(sha(MODEL016)==BASE_SHA,'Approved016 model differs')
    approval_path=REVIEW/'USER_APPROVAL_20261105.json'
    approval=json.loads(approval_path.read_text())
    require(approval['approvedBy']=='user' and approval['answer']=='Valider les six colonnes'
            and approval['approvedBaseModelSha256']==BASE_SHA,'Missing exact separate017 approval')
    require(approval['reviewSha256']==sha(REVIEW/'REVIEW.md') and approval['visualReviewSha256']==sha(REVIEW/'review.html'),'Reviewed field specification differs')
    model=copy.deepcopy(json.loads(MODEL016.read_text()))
    tables=[t for s in model['schemas'] for t in s['tables']]
    table=next(t for t in tables if t['qualified_name']==TABLE)
    require(table['write_mode']=='append_only','Unexpected observation storage mode')
    for value,state,typ,description in FIELDS:
        require(value not in table['columns'] and state not in table['columns'],'Core field already exists')
        table['columns'][value]={'type':typ,'nullable':True,'description':description}
        table['columns'][state]={'type':'text','nullable':False,'default_sql':"'unrecorded'",
                                'description':'Explicit source presence for '+value+'; unrecorded is unknown, not absence'}
        table['checks'].append({'name':'match_observation_'+state+'_ck',
            'sql':f"({state} IN ('unrecorded','absent','null') AND {value} IS NULL) OR ({state}='value' AND {value} IS NOT NULL)"})
    active=[t for t in tables if t['phase']!='models']
    require((len(tables),sum(len(t['columns']) for t in tables),sum(len(t['foreign_keys']) for t in tables))==(107,1911,466),'Wrong017 model totals')
    require((len(active),sum(len(t['columns']) for t in active),sum(len(t['foreign_keys']) for t in active))==(98,1829,447),'Wrong017 active totals')
    model['format_version']='1.4.0-native-match-core-107'
    model['status']='user_approved_native_match_core_not_deployed'
    model['planning']['columns']=1911
    model['native107_core_adoption']={'approvalSha256':sha(approval_path),'baseModelSha256':BASE_SHA,'migration':'017',
        'activeTables':98,'activeColumns':1829,'activeForeignKeys':447,'addedColumns':6,'addedChecks':3,
        'newTables':0,'newHistoryTables':0,'newJsonbColumns':0,'modelFields':TABLE,'sqlQualification':'not_executed'}
    return model


def binding(model_sha):
    original=json.loads((ROOT/'docs/verification/orion-pro-native107-20261105/PUBLICATION_BINDING.json').read_text())
    original['kind']='native107_core017_publication_binding_v1'
    original['modelPath']=str(MODEL017.relative_to(ROOT));original['modelSha256']=model_sha
    original['transformVersion']=TRANSFORM;original['metricsContractVersion']=METRICS
    parts=original['nativeToken']['digestInputArray'];parts[2]=model_sha;parts[8]=TRANSFORM;parts[9]=METRICS
    original['jointDigest']['nativeComponent']+=' Includes the six typed core fields, their exact observation provenance, and qualified core/momentum inputs. All components share the same effective DG/CG.'
    original['coexistence']['legacy']+=' 016-native builds use the original f516 binding, selected by their immutable transform/metrics pair. Core017 builds use this distinct pair; never sniff installed columns to choose a token contract.'
    original['coexistence']['exclusivePublisher']='Only the separate017 writer contract can publish an upgraded core build; its current pointer cannot downgrade to016-native or legacy. Old pinned READYs remain readable.'
    original['suggestedCommit']='feat: preserve three native match core fields in typed observations'
    return original


def save_exact(path, body, write):
    if write and not path.exists():
        with path.open('xb') as stream:stream.write(body)
    require(path.is_file() and path.read_bytes()==body,'Noncanonical artifact '+str(path.relative_to(ROOT)))


def compile017(model):
    require(sha(MIGRATION016)==PARENT016_SHA and MIGRATION016.read_bytes()==compile_migration(),'Expected exact qualified016 parent')
    table=next(t for s in model['schemas'] for t in s['tables'] if t['qualified_name']==TABLE)
    out=['-- Separately approved six typed core fields; no new table, JSONB or history.',f'-- Exact016 parent: {PARENT016_SHA}.']
    for value,state,_,_ in FIELDS:
        for name in [value,state]:
            spec=table['columns'][name]
            out.append(f'ALTER TABLE {relation(TABLE)} ADD COLUMN {column(name,spec)};')
            out.append(column_comment(TABLE,name,spec))
        constraint=next(c for c in table['checks'] if c['name']=='match_observation_'+state+'_ck')
        out.append(f'ALTER TABLE {relation(TABLE)} ADD {check(constraint)};')
    # 017 is a distinct binding, never a reinterpretation of retained 016 READYs.
    out.append('''CREATE OR REPLACE FUNCTION ingest.native107_no_publication_downgrade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $native107$
DECLARE
 incoming integer;
BEGIN
 SELECT CASE
  WHEN b.metrics_contract_version='orion_pro_native107_core_v1' AND b.transform_version='orion_pro_publish_native107_core_v1' THEN 2
  WHEN b.metrics_contract_version='orion_pro_native107_v1' AND b.transform_version='orion_pro_publish_native107_v1' THEN 1
  ELSE 0 END INTO incoming FROM analytics.aggregation_builds b WHERE b.id=NEW.build_id;
 IF EXISTS (SELECT 1 FROM analytics.publication_versions p JOIN analytics.aggregation_builds b ON b.id=p.build_id
     WHERE p.competition_season_id=NEW.competition_season_id AND p.published_to_gen=NEW.published_from_gen
       AND (CASE
        WHEN b.metrics_contract_version='orion_pro_native107_core_v1' AND b.transform_version='orion_pro_publish_native107_core_v1' THEN 2
        WHEN b.metrics_contract_version='orion_pro_native107_v1' AND b.transform_version='orion_pro_publish_native107_v1' THEN 1
        ELSE 0 END)>coalesce(incoming,0)) THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: publication cannot downgrade to the previous contract';
 END IF;
 RETURN NEW;
END;
$native107$;
REVOKE ALL ON FUNCTION ingest.native107_no_publication_downgrade() FROM PUBLIC;''')
    return ('\n\n'.join(out)+'\n').encode()


def main():
    parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--materialize',action='store_true');group.add_argument('--check-model',action='store_true')
    group.add_argument('--emit-migration',action='store_true');group.add_argument('--check',action='store_true')
    args=parser.parse_args();model=materialize();body=encoded(model);model_sha=hashlib.sha256(body).hexdigest()
    save_exact(MODEL017,body,args.materialize)
    path=REVIEW/'PUBLICATION_BINDING_017.json';save_exact(path,encoded(binding(model_sha)),args.materialize)
    result={'kind':'native107_core017_materialized_offline','modelSha256':model_sha,'bindingSha256':sha(path),
        'tables':107,'columns':1911,'newJsonb':0,'pgConnections':0,'sqlQualification':'not_executed'}
    if args.emit_migration or args.check:
        save_exact(MIGRATION017,compile017(model),args.emit_migration)
        result['migrationSha256']=sha(MIGRATION017)
    print(json.dumps(result))


if __name__=='__main__':main()
