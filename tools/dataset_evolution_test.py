"""No production writes: collector, OIDC signature, lineage and AI failure tests."""
import copy
import importlib.util
import io
import json
import os
import pathlib
import sys
import time
import unittest
import urllib.error
from unittest.mock import patch

ROOT = pathlib.Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
import dataset_evolution_core as core
from api import dataset_evolution as api
spec = importlib.util.spec_from_file_location('collector', ROOT / 'tools/dataset_evolution_sync.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

SHA = 'a' * 40


def entry():
    e = core.changes({'sha': SHA, 'message': 'Pulse fix\n\nDataset-Task: evo-bbbbbbbbbbbb-pulse', 'committedAt': '2026-10-04T00:00:00Z'}, [{'path': 'newbiz-core.js', 'additions': 2, 'deletions': 1}], '+ change')
    e.update({'tasks': core.rule_tasks(e), 'analysisState': 'pending', 'analysisAttempts': 0, 'deploymentEvents': []})
    return e


class EvolutionTests(unittest.TestCase):
    def test_stable_tasks_and_no_accuracy_claim(self):
        a, b = entry(), entry()
        self.assertEqual(a['tasks'], b['tasks'])
        self.assertEqual(a['linkedTaskIds'], ['evo-bbbbbbbbbbbb-pulse'])
        self.assertFalse(a['accuracyValidated'])
        self.assertIn('Dataset-Task: evo-aaaaaaaaaaaa-pulse', a['tasks'][0]['prompt'])

    def test_ai_validation_and_domain_coverage(self):
        e = entry()
        e['domains'] = ['pulse', 'gaze']
        v = {'summary': '변경 관측; 실측 미검증', 'tasks': [{'domain': 'pulse', 'title': 'test', 'rationale': 'test', 'validationPlan': 'test', 'prompt': 'test'}]}
        result = core.validate_analysis(v, e)
        self.assertEqual(len(result['tasks']), 2)
        self.assertEqual(result['tasks'][1]['generator'], 'rule')
        self.assertIn(SHA, result['tasks'][0]['prompt'])
        for bad in ({'summary': 'x', 'tasks': []}, {'summary': 'x', 'tasks': [{'domain': 'invented'}]}):
            with self.assertRaises(ValueError): core.validate_analysis(bad, e)

    def test_event_idempotence_and_deployment_distinction(self):
        status = {'id': 2, 'state': 'success', 'created_at': '2026-10-04T00:00:00Z'}
        event = collector.deployment_event({'id': 1, 'environment': 'Preview', 'production_environment': False}, status)
        self.assertFalse(event['production'])
        self.assertEqual(collector.merge_events([event], [event]), [event])
        e = entry()
        e['deploymentEvents'] = [event, {'key': 'check-3', 'type': 'commit-status', 'context': 'Vercel', 'state': 'success'}]
        self.assertEqual(e['tasks'][0]['state'], 'proposed')
        self.assertFalse(e['accuracyValidated'])

    def test_merge_keeps_ai_and_disjoint_events(self):
        older = entry()
        older.update({'analysisState': 'generated', 'analysis': {'summary': 'kept'}})
        older['deploymentEvents'] = [{'key': 'one', 'state': 'pending'}]
        incoming = entry()
        incoming['deploymentEvents'] = [{'key': 'two', 'state': 'success'}]
        result = collector.merge_ledgers({'entries': [older]}, {'entries': [incoming]})['entries'][0]
        self.assertEqual(result['analysis']['summary'], 'kept')
        self.assertEqual(len(result['deploymentEvents']), 2)

    def test_ai_failure_preserves_rule_prompt_and_stops_after_five(self):
        ledger = {'entries': [entry()]}
        with patch.object(collector, 'ai_analyze', side_effect=urllib.error.HTTPError('url', 503, 'secret response', {}, io.BytesIO(b'{"code":"GEMINI_UNAVAILABLE","error":"secret response"}'))) as call:
            collector.enrich(ledger)
            self.assertEqual(ledger['entries'][0]['analysisError'], 'HTTP_503')
            self.assertEqual(ledger['entries'][0]['analysisErrorCode'], 'GEMINI_UNAVAILABLE')
            self.assertTrue(ledger['entries'][0]['tasks'][0]['prompt'])
            self.assertNotIn('secret response', json.dumps(ledger))
            ledger['entries'][0]['analysisAttempts'] = 5
            collector.enrich(ledger)
            self.assertEqual(call.call_count, 1)

    def test_no_change_does_not_publish(self):
        ledger = {'schema': core.SCHEMA, 'entries': [entry()], 'coverage': {}}
        with patch.object(collector, 'repository_log', return_value=(copy.deepcopy(ledger), 'blob')), patch.object(collector, 'github') as request:
            collector.publish(copy.deepcopy(ledger))
            request.assert_not_called()

    def test_rate_limit_stops_batch_and_next_runs(self):
        second = entry()
        second['sha'] = 'b' * 40
        ledger = {'entries': [entry(), second]}
        error = urllib.error.HTTPError('url', 429, 'limited', {}, io.BytesIO(b'{"code":"GEMINI_RATE_LIMIT"}'))
        with patch.object(collector, 'ai_analyze', side_effect=error) as request:
            collector.enrich(ledger)
            self.assertEqual(request.call_count, 1)
            self.assertEqual(second['analysisState'], 'pending')
            self.assertEqual(ledger['aiCooldownReason'], 'GEMINI_RATE_LIMIT')
            collector.enrich(ledger)
            self.assertEqual(request.call_count, 1)

    def test_bookkeeping_commit_is_ignored(self):
        def git(*args):
            if args[0] == 'rev-list': return SHA
            if args[0] == 'show': return '1\t1\tdataset-evolution-log.json\n'
            return SHA
        with patch.object(collector, 'git', side_effect=git):
            self.assertEqual(collector.collect(collector.empty())['entries'], [])

    def test_oidc_signature_scope_expiry_and_algorithm(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        claims = {'iss': api.ISSUER, 'aud': api.AUDIENCE, 'sub': 'repo:'+core.REPOSITORY+':ref:refs/heads/main',
                  'repository_id': core.REPOSITORY_ID, 'repository': core.REPOSITORY, 'ref': 'refs/heads/main',
                  'workflow_ref': api.WORKFLOW, 'event_name': 'push', 'exp': int(time.time())+60, 'iat': int(time.time()), 'nbf': int(time.time())-1}
        fake = type('Key', (), {'key': key.public_key()})()
        with patch.object(api.JWKS, 'get_signing_key_from_jwt', return_value=fake):
            self.assertEqual(api.authorize(jwt.encode(claims, key, algorithm='RS256'))['repository_id'], core.REPOSITORY_ID)
            for field, value in [('repository_id','other'),('workflow_ref','other'),('ref','refs/heads/evil'),('aud','other'),('exp',int(time.time())-5),('event_name','pull_request')]:
                with self.assertRaises(api.RequestError): api.authorize(jwt.encode({**claims,field:value},key,algorithm='RS256'))
            with self.assertRaises(api.RequestError): api.authorize(jwt.encode(claims, 'a'*40, algorithm='HS256'))
            deployment_claims = {**claims, 'event_name': 'deployment_status', 'sub': 'repo:'+core.REPOSITORY+':environment:Production', 'ref': SHA, 'sha': SHA, 'run_id': '123', 'workflow_ref': api.WORKFLOW.split('@')[0]+'@'+SHA}
            run = {'head_branch': 'main', 'path': '.github/workflows/dataset-evolution.yml', 'event': 'deployment_status', 'head_sha': SHA, 'repository': {'id': int(core.REPOSITORY_ID)}}
            with patch.object(api.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(run).encode())):
                self.assertEqual(api.authorize(jwt.encode(deployment_claims,key,algorithm='RS256'))['sha'], SHA)
            with patch.object(api.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps({**run,'head_branch':'evil'}).encode())):
                with self.assertRaises(api.RequestError): api.authorize(jwt.encode(deployment_claims,key,algorithm='RS256'))

    def test_endpoint_unauthorized_and_wrong_sha(self):
        handler = object.__new__(api.handler)
        handler.headers = {}
        handler.send_json = lambda status, value: setattr(handler, 'output', (status, value))
        handler.do_POST()
        self.assertEqual(handler.output[0], 401)
        with patch.object(api.urllib.request, 'urlopen') as request:
            with self.assertRaises(api.RequestError): api.commit_evidence('https://evil.invalid')
            request.assert_not_called()

    def test_oversized_ledger_uses_raw_content(self):
        expected = {'schema': core.SCHEMA, 'entries': []}
        with patch.object(collector, 'github', side_effect=[{'sha':'blob','content':'','encoding':'none'}, expected]) as request:
            result, sha = collector.repository_log()
            self.assertEqual((result, sha), (expected,'blob'))
            self.assertEqual(request.call_args.kwargs['accept'], 'application/vnd.github.raw+json')


if __name__ == '__main__': unittest.main()
