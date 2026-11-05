#!/usr/bin/env python3
"""Materialize the approved native107 amendment without opening a database.

The immutable model103/compiler/migrations are inputs, never output targets.
The pre-code static workflow and its missing-model RED precede this module.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
PROPOSAL = ROOT / 'docs/verification/orion-pro-match-details-20261104'
MODEL = ROOT / 'docs/architecture/orion-native-details-107-20261105/target-schema.approved-107.json'
MIGRATION = ROOT / 'dashboard/backend/migrations/016_orion_pro_native_match_details.sql'
POLICY_ID = 'native-match-details-m107-rds016-v1'
EXPECTED = {
    BASE: '18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08',
    PROPOSAL / 'PROPOSED_MODEL.patch.json': 'd8626f25dff07e6f1562273bdac88fc849623065389da9c88df2e6583f62575b',
    PROPOSAL / 'AMENDMENT_SPEC.json': 'd21938839a5c20853cf2f916b3230b3e06245db7da94ca1c6d6e2a4223dfa7a6',
    PROPOSAL / 'target-schema.native-details.CANDIDATE.json': 'be2251bfdbf8e3253503cd2b4172f26b580994a0e3c100553f50532399da34aa',
    ROOT / 'dashboard/backend/migrations/012_orion_pro_domain.sql': 'f255868599c72d69f40f575a919045325ea1093a00fe4f5a6b96eae9f2c49f65',
    ROOT / 'dashboard/backend/migrations/013_orion_pro_integrity.sql': '85525221cad51b32aff79a777098211b4112f9f00ea7161ac93945654eeb6968',
    ROOT / 'dashboard/backend/migrations/014_orion_pro_membership_nonnull.sql': 'e0810f8670b2cb627ade2c76e3c8eb527ab31fd595d5cf939fd63bfc5cf649d6',
    ROOT / 'dashboard/backend/migrations/015_orion_pro_metric_membership_guard.sql': '3b85fcb4fe9380cc5f96238620ff3f4bedee7485ed52c98fef0bddfac1092bd7',
    ROOT / 'dashboard/scripts/orion_pro_schema.py': '6f4578b10c2344885bbf79ab0853fe0f0fd7fffa0663ee74600f5c6ebbe544c3',
    ROOT / 'dashboard/scripts/orion_pro_integrity.py': '32aa1c84cbf3900b28fe2c1e186e4ba56695f83aeea17d5d1336882fec9aae85',
}

def require(condition, message):
    if not condition: raise ValueError(message)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n').encode('utf-8')

def apply_approved_patch(base, patch):
    require(type(patch) is list and len(patch)==204, 'Unapproved patch size')
    result=copy.deepcopy(base); counts={}
    for operation in patch:
        require(set(operation)=={'op','path','value'}, 'Unapproved patch shape')
        op=operation['op']; counts[op]=counts.get(op,0)+1
        path=operation['path']; require(type(path) is str and path.startswith('/'), 'Invalid JSON Pointer')
        tokens=[s.replace('~1','/').replace('~0','~') for s in path[1:].split('/')]
        parent=result
        for token in tokens[:-1]:parent=parent[int(token)] if type(parent) is list else parent[token]
        token=tokens[-1]
        if type(parent) is list:
            if token=='-':
                require(op=='add', 'Only append may use -');parent.append(copy.deepcopy(operation['value']));continue
            require(token.isdecimal() and str(int(token))==token, 'Noncanonical array index')
            token=int(token)
        if op=='test':require(parent[token]==operation['value'], 'Patch precondition differs: '+path)
        elif op=='replace':
            require(token in parent if type(parent) is dict else 0<=token<len(parent), 'Missing replacement target')
            parent[token]=copy.deepcopy(operation['value'])
        elif op=='add':
            if type(parent) is list:
                require(0<=token<=len(parent),'Invalid insertion index');parent.insert(token,copy.deepcopy(operation['value']))
            else:
                require(token not in parent, 'An add cannot silently replace');parent[token]=copy.deepcopy(operation['value'])
        else:raise ValueError('Unapproved patch operation')
    require(counts=={'test':15,'replace':6,'add':183}, 'Unapproved patch operations')
    return result

def approved_model():
    for path,digest in EXPECTED.items():require(sha(path)==digest,'Immutable input differs: '+str(path.relative_to(ROOT)))
    approval_path=PROPOSAL/'USER_APPROVAL_20261105.json'; approval=json.loads(approval_path.read_text())
    require(approval['kind']=='user_approved_native_match_details_extension_v1' and approval['approvedBy']=='user', 'Missing user approval')
    require(approval['baseModelSha256']==EXPECTED[BASE] and approval['jsonPatchSha256']==EXPECTED[PROPOSAL/'PROPOSED_MODEL.patch.json'] and approval['amendmentSpecSha256']==EXPECTED[PROPOSAL/'AMENDMENT_SPEC.json'], 'Approval pins differ')
    model=apply_approved_patch(json.loads(BASE.read_text()), json.loads((PROPOSAL/'PROPOSED_MODEL.patch.json').read_text()))
    require(model==json.loads((PROPOSAL/'target-schema.native-details.CANDIDATE.json').read_text()),'Reviewed structural candidate differs')
    tables=[t for s in model['schemas'] for t in s['tables']]
    require(len(tables)==107 and sum(len(t['columns']) for t in tables)==1905 and sum(len(t['foreign_keys']) for t in tables)==466,'Approved structural totals differ')
    require(sum(c['type']=='jsonb' for t in tables for c in t['columns'].values())==51, 'Unexpected JSONB')
    require(sum(t['phase']=='models' for t in tables)==9,'Deferred model scope differs')
    classes=model['selective_versioning']
    # The approved proposal retains old planning metadata. Recompute these lists
    # from the materialized table kinds without reclassifying any old relation.
    parent_children=[t['qualified_name'] for t in tables if t.get('versioning',{}).get('kind')=='parent_version_child']
    require(set(classes['parent_version_children']).issubset(parent_children) and len(parent_children)==10,'Parent-child classes differ')
    classes['parent_version_children']=parent_children
    model['planning'].update(tables=len(tables),columns=sum(len(t['columns']) for t in tables),foreign_keys=sum(len(t['foreign_keys']) for t in tables),
                             version_classes={name:len(classes[name]) for name in ('selected_relations','parent_version_children','existing_append_only','stable_identities')})
    model['format_version']='1.3.0-native-details-107'
    model['status']='user_approved_native_match_details_not_deployed'
    model['native107_adoption']={
        'kind':'approved_native_match_details_materialization_v1', 'approval_path':str(approval_path.relative_to(ROOT)), 'approval_sha256':sha(approval_path),
        'base_model_sha256':EXPECTED[BASE], 'json_patch_sha256':EXPECTED[PROPOSAL/'PROPOSED_MODEL.patch.json'],
        'reviewed_structural_candidate_sha256':EXPECTED[PROPOSAL/'target-schema.native-details.CANDIDATE.json'],
        'patch_operations':{'test':15,'replace':6,'add':183}, 'policy_id':POLICY_ID,
        'metadata_only_changes':['format_version','status','planning.tables','planning.columns','planning.foreign_keys','planning.version_classes','selective_versioning.parent_version_children','native107_adoption'],
        'migration':'016_orion_pro_native_match_details.sql', 'sql_qualification':'not_executed', 'rds_apply_authorized':False,
        'active_tables':98, 'active_columns':1823, 'active_foreign_keys':447, 'deferred_model_tables':9,
        'new_independent_history_tables':0, 'new_jsonb_columns':0, 'new_source_body_stores':0,
    }
    return model

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--materialize',action='store_true',help='write only the new approved model; offline')
    group.add_argument('--check-model',action='store_true',help='verify exact approved model bytes; offline')
    group.add_argument('--check',action='store_true',help='verify approved model and deterministic migration bytes; offline')
    args=parser.parse_args()
    model=approved_model(); body=encoded(model)
    if args.materialize:
        if MODEL.exists():require(MODEL.read_bytes()==body,'Refusing to overwrite different approved model')
        else:MODEL.parent.mkdir(parents=True,exist_ok=True);MODEL.write_bytes(body)
    else:require(MODEL.read_bytes()==body,'Approved model bytes differ')
    result={'kind':'native107_schema_offline_v1','modelPath':str(MODEL.relative_to(ROOT)), 'modelSha256':hashlib.sha256(body).hexdigest(),
            'policyId':POLICY_ID,'pgConnections':0,'networkCalls':0,'sqlQualification':'not_executed'}
    if args.check:
        require(MIGRATION.is_file(),'Migration016 not yet implemented')
        raise ValueError('Deterministic migration compiler not yet implemented')
    print(json.dumps(result,ensure_ascii=False,sort_keys=True))

if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,FileNotFoundError) as exc:
        print(json.dumps({'kind':'native107_schema_error','error':str(exc)},ensure_ascii=False),file=sys.stderr);raise SystemExit(1)
