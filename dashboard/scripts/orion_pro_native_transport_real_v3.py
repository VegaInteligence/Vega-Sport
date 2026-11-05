#!/usr/bin/env python3
"""Transport the frozen real model103 core from P1 overlay to actual RDS015.

Offline by default. Only a separately released ROOT operation can open clients.
The qualified real source receipt parser and SQL/COPY implementation stay frozen.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import marshal
import os
from pathlib import Path
import stat
import sys
import time
from types import FunctionType

sys.dont_write_bytecode = True
import orion_pro_native_transport_real_v2 as old

ROOT = old.ROOT
BASE = old.BASE.parent / 'transport-real-v3'
BINDINGS = BASE / 'BINDINGS.json'
BINDINGS_SHA = 'e9766c90d397fa5bec21a20ad6c21effaad589e211049c9ba3ef82529f9d0cdf'
VERSION = 'orion_pro_native_transport_real_v3'
PHASE_VERSION = 'orion_pro_native_transport_real_phase_v3'
PAIR_KIND = 'explicit_native_sql_transport_real_v3_pair'
ACCEPTANCE_KIND = 'native_sql_real_p2_acceptance_v3'
RELEASE_KIND = 'native_transport_operation_release_v3'
RELEASE_SCOPE = 'typed_real_core_p2_015'
TARGET_POLICY_SHA = '33b1feda0e47bf24da6c8e0c2d40160485acaac242b8c33572c3e9881a65ee83'
TARGET_DIR = BASE / 'target-readbacks/20261105T162800497757Z'
TARGET_READBACK = TARGET_DIR / 'result.json'
TARGET_READBACK_SHA = 'c4278cc6566566e6755f47437df6eadbbdaff26e086fd7676d71378df8bcc713'
TARGET_DESCRIPTOR = TARGET_DIR / 'target-descriptor.json'
TARGET_DESCRIPTOR_SHA = '6820c368e2238266c61cdb41bbc5943de7b8b14090e58ad6b20d37f2da879c5f'
ROOT_TARGET_RECEIPT = TARGET_DIR / 'root-result.json'
ROOT_TARGET_RECEIPT_SHA = '279c90f27aae93031ad1e8971f9f46c5d750150cdb85c8534b019a52ebfbdb86'
RECOVERY = BASE.parent / 'core-checkpoint'
SOURCE_LOGICAL_CP = RECOVERY / 'runs-v2/20261105T115732447984Z/checkpoint.json'
SOURCE_LOGICAL_SHA = '35dba5b977335c957d39472ca85dbfc6c2ce0074a94a558badbec32f82fb73cc'
HISTORICAL_RUN = RECOVERY / 'runs-v2/20261105T125423772600Z'
HISTORICAL_CP = HISTORICAL_RUN / 'checkpoint.json'
HISTORICAL_CP_SHA = '8f4d77a9358a36419ac6424560c98f8ebf166e882702aac968f2e69a36164db6'
SOURCE_NATIVE = HISTORICAL_RUN / 'native94-after.json'
SOURCE_NATIVE_SHA = 'e0ba27c04c2d0936c9447c2a2aa74c1cfa8733d1062b855794cdf69032e6db79'
RECOVERY_CODE = {'controller_v2.py': '954c91312539a73f5d29e63e6a02022136dffc521d4cdc24cfbca464358588dc',
                 'e2e_v2.py': '635a8e9ac5205a40b75df07554042db5344bc6160e2668265bb9a8674169af07',
                 'PROTOCOL_V2.md': '4ab7492090b4c1ab99b5d62663cae80cee38da1331ceec8f907456614649dc38',
                 'PINS_V2.json': 'bddbe0fc5a1703186475b2d1c5512047e2f1a683af3721a13102e107df7d4d21'}
ROUTING_KEYS = frozenset({'marker', 'markerPath', 'sourceDescriptor', 'sourceDescriptorSha256', 'native94Evidence'})
POLICY_KEYS = ('policyId', 'migration015Sha256', 'canonicalDefinitionSha256', 'beforeStateSha256',
               'accountedSequenceGaps', 'actualAfterStateSha256', 'actualAfterNativeSha256',
               'actualAdoptionReceiptSha256')
COPIED_ROWS = 553545
SOURCE_SEMANTIC_31 = '5f9175c1526ad2db4426ebe02d3e412e20999c2bd6486aef5d82d082f34255e0'
OLD_CONSTANTS = {k: vars(old)[k] for k in ('VERSION', 'PHASE_VERSION', 'BINDINGS', '__file__')}
Refusal, require = old.Refusal, old.require
digest, hashed, canonical = old.digest, old.hashed, old.canonical
exact_keys, sha_shape = old.exact_keys, old.sha_shape


def checked_json(path, expected, maximum=1024 ** 2):
    """Admit the exact bounded bytes parsed, rejecting links and duplicate keys."""
    require(sha_shape(expected), 'BINDING', 'Exact metadata hash required')
    try:
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as file:
            info = os.fstat(file.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_size <= maximum, 'BINDING', 'Regular bounded metadata file required')
            raw = file.read(maximum + 1)
        require(len(raw) <= maximum and hashlib.sha256(raw).hexdigest() == expected,
                'BINDING', 'Exact accepted metadata bytes differ')

        def unique(items):
            result = {}
            for key, value in items:
                require(key not in result, 'BINDING', 'Duplicate JSON key refused')
                result[key] = value
            return result

        return json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
    except (OSError, ValueError, TypeError, UnicodeError) as error:
        raise Refusal('BINDING', 'Malformed bounded metadata') from error


def fixed_bindings():
    binding = checked_json(BINDINGS, BINDINGS_SHA)
    require(not sys.flags.optimize, 'BINDING', 'Immutable policy assertions must be enabled')
    require(binding['kind'] == 'real_normalizer_p2_015_transport_dependencies_v3' and
            binding['writerVersion'] == VERSION and binding['targetPolicySha256'] == TARGET_POLICY_SHA and
            binding['finalProductionCaps'] is False and binding['fullAcceptance'] is False and
            len(binding['inputs']) == 57, 'BINDING', 'Unknown P2 transport dependency binding')
    for name, expected in binding['inputs'].items():
        path = ROOT / name
        info = path.lstat()
        require(path.resolve().is_relative_to(ROOT) and stat.S_ISREG(info.st_mode) and info.st_size <= 8 * 1024 ** 2
                and digest(path) == expected, 'BINDING', 'A frozen transport/model/producer dependency differs: ' + name)
    old.fixed_bindings()
    audit_qualified_core()
    return binding


def target_contract(policy):
    return {key: policy[key] for key in POLICY_KEYS}


def fixed_context(binding):
    policy_path = BASE / 'target_policy.py'
    spec = importlib.util.spec_from_file_location('native_transport_real_v3_policy', policy_path)
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    target = checked_json(TARGET_DESCRIPTOR, TARGET_DESCRIPTOR_SHA)
    readback = checked_json(TARGET_READBACK, TARGET_READBACK_SHA)
    root = checked_json(ROOT_TARGET_RECEIPT, ROOT_TARGET_RECEIPT_SHA)
    try:
        m = policy.load_target_policy()
        policy.validate_target_descriptor(target, m)
    except AssertionError as error:
        raise Refusal('TARGET_POLICY', 'Exact independently adopted015 target policy required: ' + str(error)) from error
    require(binding['targetPolicy'] == m['policyId'] and binding['sourcePolicy'] == m['sourcePolicy'] and
            readback['kind'] == 'real_rds_p2_015_target_descriptor_readback_v1' and
            readback['status'] == root['status'] == 'verified_actual_p2_target_descriptor' and
            root['kind'] == 'root_actual015_readonly_target_descriptor' and
            readback['targetDescriptorSha256'] == root['targetDescriptorSha256'] == TARGET_DESCRIPTOR_SHA and
            readback['targetPolicySha256'] == TARGET_POLICY_SHA and
            readback['helperSha256'] == binding['inputs'][str((BASE / 'target_readback.py').relative_to(ROOT))] and
            readback['canonicalDefinitionSha256'] == m['canonicalDefinitionSha256'] and
            readback['actualAdoptionNativeSha256'] == m['actualAfterNativeSha256'] and
            readback['actualAdoptionStateSha256'] == m['actualAfterStateSha256'] and
            readback['readTransactionRolledBack'] is True and readback['callerOwnsConnection'] is True and
            readback['fullAcceptance'] is False and readback['productionActivation'] is False and
            readback['sequenceMetadataRows'] == 67 and readback['sequenceUsage'] == 66 and
            readback['selects'] == root['selects'] == 8 and root['connections'] == 1 and
            root['connectionClosed'] is True and root['privateAuthRemoved'] is True and
            readback['rdsWrites'] == root['writes'] == [] and
            readback['sourceCalls'] == readback['ramGets'] == readback['cloudCalls'] == root['sourceCalls'] ==
            readback['sequenceValueSelects'] == readback['connectionsOpenedByHelper'] == 0,
            'TARGET_POLICY', 'Actual readonly target015 readback or ROOT cleanup differs')
    native = checked_json(SOURCE_NATIVE, SOURCE_NATIVE_SHA)
    source_contract = checked_json(old.BASE / 'REAL_SOURCE_CONTRACT.json', binding['sourceReceiptContractSha256'])
    logical = checked_json(SOURCE_LOGICAL_CP, SOURCE_LOGICAL_SHA)
    historical = checked_json(HISTORICAL_CP, HISTORICAL_CP_SHA)
    source_descriptor = checked_json(HISTORICAL_RUN / 'source-descriptor.json', historical['sourceDescriptorSha256'])
    require(len(native['tables']) == 94 and len(native['sequences']) == 67 and
            hashed(native['tables']) == source_contract['sourceNativeSha256'] == logical['native94Sha256'] and
            sum(v['rows'] for v in native['tables'].values()) == source_contract['sourceRows'] == logical['sourceRows'] == 553562 and
            source_contract['sourcePhases'] == logical['sourcePhases'] and source_contract['sourceCheckpointSha256'] == SOURCE_LOGICAL_SHA,
            'SOURCE_RECEIPT', 'Immutable logical native94/source receipt evidence differs')
    return {'targetPolicy': target_contract(m), 'target': target, 'sourceNative': native,
            'sourceContract': source_contract, 'sourceDescriptor': source_descriptor, 'logical': logical,
            'historical': historical}


def source_projection(value):
    return {key: item for key, item in value.items() if key not in ROUTING_KEYS}


def validate_pair(pair, accepted, pair_sha, binding, context, *, structural=False):
    exact_keys(pair, ['kind', 'environment', 'writerSha256', 'bindingSha256', 'source', 'target'], 'Unknown pair fields')
    exact_keys(accepted, ['kind', 'dataOrigin', 'writerSha256', 'bindingsSha256', 'pairSha256', 'modelSha256',
                          'producerSha256', 'producerVersion', 'sourceNativeSha256', 'sourceTables', 'sourceRows',
                          'sourcePhases', 'sourceCheckpointSha256', 'fullAcceptance', 'realSource',
                          'sourceServiceCheckpointSha256', 'targetReadbackSha256', 'targetPolicy'],
               'Unknown V3 acceptance fields')
    require(pair['kind'] == PAIR_KIND and pair['environment'] == 'rds' and accepted['kind'] == ACCEPTANCE_KIND and
            accepted['dataOrigin'] == old.REAL_ORIGIN and accepted['fullAcceptance'] is False and
            pair['writerSha256'] == accepted['writerSha256'] == digest(Path(__file__)) and
            pair['bindingSha256'] == accepted['bindingsSha256'] == BINDINGS_SHA and
            accepted['modelSha256'] == digest(old.MODEL), 'BINDING', 'Explicit P1 to P2 writer/model/origin differs')
    require(canonical(pair['target']) == canonical(context['target']) and
            canonical(accepted['targetPolicy']) == canonical(context['targetPolicy']) and
            accepted['targetReadbackSha256'] == TARGET_READBACK_SHA,
            'TARGET_POLICY', 'Exact independently observed P2/015 target, journal and accounted sequence state required')
    source = pair['source']
    frozen = context['sourceDescriptor']
    exact_keys(source, frozen, 'Unknown source descriptor fields')
    endpoint = source['endpoint']
    exact_keys(endpoint, frozen['endpoint'], 'Unknown source endpoint fields')
    require(canonical({**source, 'endpoint': {**endpoint, 'postmasterStartedAt': frozen['endpoint']['postmasterStartedAt']}})
            == canonical(frozen),
            'SOURCE_POLICY', 'Source must retain its exact P1 overlay and original journal/clocks')
    epoch = datetime.fromisoformat(endpoint['postmasterStartedAt'])
    historical = datetime.fromisoformat(frozen['endpoint']['postmasterStartedAt'])
    require(epoch.tzinfo is not None and (epoch == historical if structural else historical < epoch <= datetime.now(timezone.utc)),
            'SOURCE_SERVICE', 'Current recovered source epoch required')
    require(sha_shape(accepted['sourceServiceCheckpointSha256']) and
            (accepted['sourceServiceCheckpointSha256'] == HISTORICAL_CP_SHA if structural else
             accepted['sourceServiceCheckpointSha256'] not in {SOURCE_LOGICAL_SHA, HISTORICAL_CP_SHA}),
            'SOURCE_SERVICE', 'Historical source checkpoint is not a live service authority')
    contract = context['sourceContract']
    logical = context['logical']
    require(accepted['sourceCheckpointSha256'] == SOURCE_LOGICAL_SHA and
            accepted['sourceNativeSha256'] == contract['sourceNativeSha256'] and
            accepted['sourceRows'] == contract['sourceRows'] and
            canonical(accepted['sourcePhases']) == canonical(contract['sourcePhases']) and
            accepted['sourceTables'] == context['sourceNative']['tables'] and
            all(type(v['rows']) is int and 0 <= v['rows'] <= 500000 for v in accepted['sourceTables'].values()) and
            type(accepted['sourceRows']) is int and accepted['sourceRows'] <= 2000000,
            'SOURCE_RECEIPT', 'Exact bounded native94/source checkpoint/phase acceptance required')
    expected_real = {'normalizerSha256': logical['producerSha256'], 'manifestSha256': logical['manifestSha256'],
                     'candidateSha256': logical['candidateSha256'], 'checkpointKind': logical['kind'],
                     'receiptHashKind': contract['receiptHashKind'],
                     'sourceContractSha256': binding['sourceReceiptContractSha256']}
    require(accepted['realSource'] == expected_real and accepted['producerSha256'] == logical['producerSha256'] and
            accepted['producerVersion'] == logical['producerVersion'], 'SOURCE_RECEIPT', 'Frozen native producer differs')
    require(accepted['pairSha256'] == pair_sha and sha_shape(pair_sha), 'BINDING', 'Exact pair hash required')


def validate_service(path, sha, marker_path, pair, accepted, context):
    require(sha == accepted['sourceServiceCheckpointSha256'], 'SOURCE_SERVICE', 'Exact recovered service checkpoint required')
    actual = checked_json(path, sha, 16384)
    run = path.resolve().parent
    require(path.name == 'checkpoint.json' and run.parent == RECOVERY / 'runs-v2' and
            run not in {SOURCE_LOGICAL_CP.parent, HISTORICAL_RUN} and not (run / 'result.json').exists(),
            'SOURCE_SERVICE', 'Checkpoint must come from a currently READY recovery run')
    exact_keys(actual, context['logical'], 'Unknown service checkpoint fields')
    require(canonical(source_projection(actual)) == canonical(source_projection(context['logical'])) ==
            canonical(source_projection(context['historical'])), 'SOURCE_SERVICE',
            'Recovered source logical checkpoint changed')
    historical_marker = context['historical']['marker']
    epoch = pair['source']['endpoint']['postmasterStartedAt']
    require(canonical(actual['marker']) == canonical({**historical_marker, 'postmasterStartedAt': epoch}) and
            marker_path.is_absolute() and str(marker_path) == actual['markerPath'] == context['historical']['markerPath'],
            'SOURCE_SERVICE', 'Recovered marker root, certificate or epoch differs')
    descriptor_path, native_path = run / 'source-descriptor.json', run / 'native94-before.json'
    require(actual['sourceDescriptor'] == str(descriptor_path) and actual['native94Evidence'] == str(native_path) and
            checked_json(descriptor_path, actual['sourceDescriptorSha256']) == pair['source'] and
            checked_json(native_path, SOURCE_NATIVE_SHA) == context['sourceNative'] and
            checked_json(run / 'native94-after.json', SOURCE_NATIVE_SHA) == context['sourceNative'],
            'SOURCE_SERVICE', 'Service source descriptor or full native94/67 continuity differs')
    ready = old.read_json(run / 'ready.json')
    semantic = old.read_json(run / 'native31-oracle.json')
    noop = old.read_json(run / 'fresh-noop.json')
    require(ready['kind'] == 'committed_core_readonly_recovery_v2' and ready['status'] == 'ready' and
            ready['checkpointSha256'] == sha and ready['counts'] == {'pass': 7, 'fail': 0, 'unverified': 0} and
            ready['pgStarts'] == 1 and ready['sourceRamReads'] == 2 and ready['businessWrites'] ==
            ready['sourceConstructions'] == ready['remoteCalls'] == 0 and
            [(c['case'], c['status']) for c in ready['cases']] == [(name, 'pass') for name in (
                'retained_stopped_root', 'exact_readonly_identity_and_policy', 'exact_single_committed_core',
                'independent_native31_core', 'independent_native94_sequence67_before',
                'fresh_process_core_only_noop', 'independent_native94_sequence67_after')] and
            semantic['sourceSha256'] == semantic['typedSha256'] == SOURCE_SEMANTIC_31 and
            semantic['sourcePerformances'] == 15437 and semantic['typedSlots'] == 478547 and semantic['errors'] == {} and
            noop['status'] == 'pass' and noop['coreReused'] is True and noop['spatialCalled'] is False and
            noop['phaseReceipt'] == old.read_json(SOURCE_LOGICAL_CP.parent / 'fresh-noop.json')['phaseReceipt'] and
            noop['newFactRevisions'] == noop['duplicateRows'] == noop['businessWrites'] == 0,
            'SOURCE_SERVICE', 'Independent semantic31 and fresh core-only no-op evidence required')
    command = ready['command']
    require(len(command) == 7 and command[1:4] == [str(RECOVERY / 'controller_v2.py'), '--recover', '--release'] and
            command[5:] == ['--release-sha256', ready['releaseSha256']], 'SOURCE_SERVICE', 'Exact recovery command required')
    recovery_release = Path(command[4])
    require(recovery_release.is_absolute() and recovery_release.parent == RECOVERY and
            all(digest(RECOVERY / name) == expected for name, expected in RECOVERY_CODE.items()),
            'SOURCE_SERVICE', 'Unchanged ROOT recovery code and release path required')
    released = checked_json(recovery_release, ready['releaseSha256'], 16384)
    recovery_expected = {'kind': 'root_committed_core_readonly_recovery_v2', 'approvedBy': 'ROOT',
                         'controllerSha256': RECOVERY_CODE['controller_v2.py'], 'testSha256': RECOVERY_CODE['e2e_v2.py'],
                         'protocolSha256': RECOVERY_CODE['PROTOCOL_V2.md'], 'pinsSha256': RECOVERY_CODE['PINS_V2.json'],
                         'ownedRoot': historical_marker['ownedRoot'], 'port': historical_marker['port'],
                         'maximumRestarts': 1, 'maximumRamReads': 2, 'sourceConstructions': 0, 'businessWrites': 0,
                         'maximumSeconds': 300, 'maximumOwnedBytes': 3 * 1024 ** 3, 'maximumProofBytes': 64 * 1024 ** 2,
                         'maximumIdleSeconds': 3600}
    allocation = released['allocationId']
    require(all(released[key] == value for key, value in recovery_expected.items()) and
            isinstance(allocation, str) and allocation.startswith('core-recovery-v') and
            allocation.removeprefix('core-recovery-v').isdigit() and int(allocation.removeprefix('core-recovery-v')) >= 4,
            'SOURCE_SERVICE', 'Separate current ROOT allocation with unchanged RO recovery bounds required')
    consumed = old.read_json(RECOVERY / (allocation + '.consumed.json'), 16384)
    require(consumed == {'run': str(run), 'releaseSha256': ready['releaseSha256'], 'state': 'consumed', 'pgRestarts': 1},
            'SOURCE_SERVICE', 'Current ROOT recovery allocation ledger differs')
    marker = old.owned_marker(marker_path)
    require(marker == actual['marker'], 'SOURCE_SERVICE', 'Live marker differs from the current checkpoint')
    return marker, actual['sourceDescriptorSha256'], ready['releaseSha256']


def validate_release(path, sha, mode, pair_sha, acceptance_sha, service_sha, readback_sha):
    release = checked_json(path, sha, 16384)
    expected = {'kind': RELEASE_KIND, 'scope': RELEASE_SCOPE, 'mode': mode, 'writerSha256': digest(Path(__file__)),
                'bindingSha256': BINDINGS_SHA, 'pairSha256': pair_sha, 'acceptanceSha256': acceptance_sha,
                'sourceServiceCheckpointSha256': service_sha, 'targetReadbackSha256': readback_sha,
                'targetPolicySha256': TARGET_POLICY_SHA, 'fullAcceptance': False}
    exact_keys(release, {*expected, 'expiresAt'}, 'Closed operation release fields required')
    expiry = datetime.fromisoformat(release['expiresAt'])
    require({k: v for k, v in release.items() if k != 'expiresAt'} == expected and
            release['fullAcceptance'] is False and expiry.tzinfo is not None and datetime.now(timezone.utc) < expiry,
            'RELEASE', 'Separate exact unexpired P2/015 operation release required')


def qualified(fn, **updates):
    """Reuse exact instructions with explicit version constants in private globals."""
    require(set(updates) <= set(fn.__code__.co_names) & set(OLD_CONSTANTS), 'BINDING', 'Unqualified code rebind')
    copy = FunctionType(fn.__code__, {**fn.__globals__, **updates}, fn.__name__, fn.__defaults__, fn.__closure__)
    copy.__kwdefaults__ = None if fn.__kwdefaults__ is None else fn.__kwdefaults__.copy()
    return copy


connect = qualified(old.connect, VERSION=VERSION)
new_report = qualified(old.new_report, VERSION=VERSION, __file__=__file__)


class NativeTransport(old.NativeTransport):
    apply = qualified(old.NativeTransport.apply, VERSION=VERSION)
    prefix = qualified(old.NativeTransport.prefix, VERSION=VERSION)
    control_binding = qualified(old.NativeTransport.control_binding, PHASE_VERSION=PHASE_VERSION, BINDINGS=BINDINGS)
    parameters = qualified(old.NativeTransport.parameters, VERSION=VERSION)

    def check_pair(self):
        validate_pair(self.pair, self.accepted, self.pair_sha, self.binding, self.admission_context)

    def snapshot_key(self, phase):
        return 'native-real-v3:' + self.accepted['sourceNativeSha256'] + ':' + phase['phase']


def audit_qualified_core():
    inherited = ('__init__', 'ownership_and_dependencies', 'self_graphs', 'sequence_inspection', 'inspect_source',
                 'source_reopen', 'target_bounds', 'verify_business', 'ranked_from', 'batches', 'copy_table',
                 'reserve', 'memory', 'buffered', 'owner', 'projection', 'native', 'business', 'source_bounds',
                 'receipts', 'baseline', 'policies', 'counters')
    require(all(getattr(NativeTransport, name) is getattr(old.NativeTransport, name) for name in inherited),
            'BINDING', 'An inherited qualified method differs')
    rebound = [(old.connect, connect, {'VERSION': VERSION}),
               (old.new_report, new_report, {'VERSION': VERSION, '__file__': __file__}),
               (old.NativeTransport.apply, NativeTransport.apply, {'VERSION': VERSION}),
               (old.NativeTransport.prefix, NativeTransport.prefix, {'VERSION': VERSION}),
               (old.NativeTransport.control_binding, NativeTransport.control_binding, {'PHASE_VERSION': PHASE_VERSION,
                                                                                         'BINDINGS': BINDINGS}),
               (old.NativeTransport.parameters, NativeTransport.parameters, {'VERSION': VERSION})]
    for before, after, updates in rebound:
        require(before.__code__ is after.__code__ and before.__defaults__ == after.__defaults__ and
                before.__kwdefaults__ == after.__kwdefaults__ and before.__closure__ == after.__closure__ and
                all(after.__globals__[key] == value for key, value in updates.items()) and
                all(after.__globals__[key] is before.__globals__[key]
                    for key in before.__code__.co_names if key in before.__globals__ and key not in updates),
                'BINDING', 'Qualified code or nonversioned global differs')
    require(OLD_CONSTANTS == {k: vars(old)[k] for k in OLD_CONSTANTS}, 'BINDING', 'Historical module globals changed')
    return {'status': 'qualified_code_identical', 'copyMethodsIdentical': True, 'oldModuleGlobalsUnchanged': True,
            'inheritedMethods': list(inherited),
            'qualifiedCodeSha256': {before.__name__: hashlib.sha256(marshal.dumps(before.__code__)).hexdigest()
                                    for before, _, _ in rebound},
            'versionGlobalsRebound': {before.__name__: {key: str(value) for key, value in updates.items()}
                                      for before, _, updates in rebound},
            'sourceReceiptAdapterSha256': digest(Path(old.__file__)), 'rawCopyCoreSha256': digest(Path(old.v2.__file__))}


def structural_check(path, sha, binding, context):
    value = checked_json(path, sha)
    exact_keys(value, ['kind', 'origin', 'realSourceExecuted', 'pair', 'acceptance', 'targetPolicy'],
               'Closed local structural fixture fields required')
    require(value['kind'] == 'local_real_v3_structure_fixture' and value['origin'] == 'local_metadata_only' and
            value['realSourceExecuted'] is False and value['targetPolicy'] == context['targetPolicy'],
            'BINDING', 'Explicit local metadata-only fixture required')
    validate_pair(value['pair'], value['acceptance'], hashed(value['pair']), binding, context, structural=True)


def native_timeout_context(error, report):
    # A COPY fault never reaches this boundary. Only native SQL diagnostics
    # from a full phase after source RR closed are eligible.
    if (getattr(error, 'sqlstate', None) != '57014' or not report.get('applicationStarted') or
            report['copiedRows'] != COPIED_ROWS or report['sourceTransactionsClosedBeforeTargetAdmission'] != 1):
        return
    context = getattr(getattr(error, 'diag', None), 'context', None)
    if not isinstance(context, str) or 'PL/pgSQL function ingest.' not in context:
        return
    raw = context.encode('utf-8')
    report['postCopyNativeTimeout'] = {'context': raw[:16384].decode('utf-8', errors='ignore'),
                                      'sha256': hashlib.sha256(raw).hexdigest(),
                                      'bytes': len(raw), 'truncated': len(raw) > 16384}


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    modes = parser.add_mutually_exclusive_group()
    for name in ('preflight-rds', 'apply-rds', 'check-local-structure', 'audit-qualified-core'):
        modes.add_argument('--' + name, action='store_true')
    for key in ('structure', 'pair', 'acceptance', 'source-service-checkpoint', 'target-readback', 'release'):
        parser.add_argument('--' + key, type=Path)
        parser.add_argument('--' + key + '-sha256')
    for key in ('source-marker', 'target-passfile', 'report'):
        parser.add_argument('--' + key, type=Path)
    args = parser.parse_args()
    report = new_report()
    report.update(connectionAttempts=0, realSourceAccepted=False, realTargetAccepted=False)
    source = target = transport = None
    locks = []
    started = time.monotonic()
    code = 0
    write_report = False
    try:
        if args.report:
            require(not args.report.exists() and not args.report.is_symlink(), 'BINDING', 'Fresh report path required')
            write_report = True
        if args.audit_qualified_core:
            fixed_bindings()
            report.update(audit_qualified_core())
        elif args.check_local_structure:
            binding = fixed_bindings()
            structural_check(args.structure, args.structure_sha256, binding, fixed_context(binding))
            report.update(status='structure_only', realSourceAccepted=False, realTargetAccepted=False)
        elif not (args.preflight_rds or args.apply_rds):
            report['nextStep'] = 'Exact current source service, observed target015 and separate ROOT release required'
        else:
            mode = 'apply-rds' if args.apply_rds else 'preflight-rds'
            require(not any(k.startswith('PG') for k in os.environ), 'ENVIRONMENT', 'Inherited libpq routing/options refused')
            require(all([args.source_marker, args.pair, args.pair_sha256, args.acceptance, args.acceptance_sha256,
                         args.source_service_checkpoint, args.source_service_checkpoint_sha256, args.target_readback,
                         args.target_readback_sha256, args.release, args.release_sha256, args.target_passfile]) and
                    not (args.structure or args.structure_sha256), 'BINDING', 'Exact current source, target015 and release inputs required')
            binding = fixed_bindings()
            context = fixed_context(binding)
            pair = checked_json(args.pair, args.pair_sha256)
            accepted = checked_json(args.acceptance, args.acceptance_sha256)
            validate_pair(pair, accepted, args.pair_sha256, binding, context)
            require(args.target_readback.resolve() == TARGET_READBACK and args.target_readback_sha256 == TARGET_READBACK_SHA,
                    'TARGET_POLICY', 'Exact actual target015 readback required')
            checked_json(args.target_readback, args.target_readback_sha256)
            validate_release(args.release, args.release_sha256, mode, args.pair_sha256, args.acceptance_sha256,
                             args.source_service_checkpoint_sha256, args.target_readback_sha256)
            marker, source_descriptor_sha, source_recovery_sha = validate_service(args.source_service_checkpoint,
                                                                                  args.source_service_checkpoint_sha256,
                                                                                  args.source_marker, pair, accepted, context)
            report.update(dataOrigin=accepted['dataOrigin'], executionEnvironment=pair['environment'],
                          pilotAdmission=binding['pilotAdmission'], finalProductionCaps=False,
                          sourceCheckpointSha256=accepted['sourceCheckpointSha256'],
                          sourceServiceCheckpointSha256=args.source_service_checkpoint_sha256,
                          sourceRecoveryReleaseSha256=source_recovery_sha,
                          sourceDescriptorSha256=source_descriptor_sha, targetDescriptorSha256=TARGET_DESCRIPTOR_SHA,
                          targetReadbackSha256=TARGET_READBACK_SHA, targetPolicySha256=TARGET_POLICY_SHA,
                          targetPolicy=accepted['targetPolicy'], pairSha256=args.pair_sha256,
                          acceptanceSha256=args.acceptance_sha256, bindingSha256=BINDINGS_SHA)
            import psycopg
            report['connectionAttempts'] += 1
            source = connect(psycopg, marker, pair['source'], source=True)
            report['connections'] += 1
            report['connectionAttempts'] += 1
            target = connect(psycopg, marker, pair['target'], source=False, real_target=True, passfile=args.target_passfile)
            report['connections'] += 1
            if args.apply_rds:
                for conn, sql in [(source, 'SELECT pg_try_advisory_lock(20261104,1)'),
                                  (target, 'SELECT pg_try_advisory_lock(20261104,2)'),
                                  (target, 'SELECT pg_try_advisory_lock(20261104,1)'),
                                  (target, 'SELECT pg_try_advisory_lock(97813003::bigint)')]:
                    require(conn.execute(sql).fetchone()[0], 'LEASE', 'Source generation or target migration/generation/serving lease occupied')
                    locks.append((conn, sql.replace('pg_try_advisory_lock', 'pg_advisory_unlock')))
            report['leasesAcquired'] = len(locks)
            transport = NativeTransport(source, target, pair, accepted, report, args.pair_sha256, binding)
            transport.admission_context = context
            transport.check_pair()
            transport.policies()
            for conn, is_source in [(source, True), (target, False)]:
                with conn.transaction():
                    transport.baseline(conn, is_source)
            source.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
            transport.inspect_source()
            transport.target_bounds()
            completed = transport.prefix()
            expected = transport.business(source, owners={0, *(p['sourceGeneration'] for p in completed)})
            source.commit()
            report['preflightSourceTransactionClosedBeforeTargetOracle'] = True
            with target.transaction():
                transport.verify_business(expected)
            require(transport.phase_rows == {accepted['sourcePhases'][0]['generation']: COPIED_ROWS},
                    'SOURCE_RECEIPT', 'Exact source-derived 553545-row phase ownership required')
            report.update(status='preflight', realSourceAccepted=True, realTargetAccepted=True)
            if args.apply_rds:
                transport.apply(completed, None)
    except BaseException as error:
        code = 1
        sqlstate = getattr(error, 'sqlstate', None)
        reason = getattr(error, 'code', None)
        if reason is None:
            reason = ('NATIVE_TIMEOUT' if sqlstate in {'57014', '25P03', '55P03'} else 'NATIVE_FK' if sqlstate == '23503'
                      else 'NATIVE_REJECTION' if sqlstate else 'BINDING' if report['connections'] == 0 else 'TRANSPORT_FAILURE')
        report.update(status='refused', reasonCode=reason, sqlstate=sqlstate,
                      error=str(error) if isinstance(error, Refusal) else type(error).__name__)
        native_timeout_context(error, report)
    finally:
        if transport is not None:
            report['generationMap'] = transport.maps_g
            report['snapshotMap'] = transport.maps_s
        for conn in (source, target):
            if conn is not None:
                try:
                    conn.rollback()
                    for owner, sql in reversed(locks):
                        if owner is conn:
                            conn.execute(sql)
                except Exception:
                    pass
                finally:
                    conn.close()
        report['connectionsClosed'] = all(c is None or c.closed for c in (source, target))
        report['elapsedMs'] = round((time.monotonic() - started) * 1000, 3)
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        text = json.dumps(report, indent=2, ensure_ascii=False, default=str) + '\n'
        require(len(text.encode()) <= 4 * 1024 ** 2, 'SOURCE_BOUND', 'Evidence report exceeds4MiB')
        if write_report:
            with args.report.open('x') as out:
                out.write(text)
        print(text)
    return code


if __name__ == '__main__':
    raise SystemExit(main())
