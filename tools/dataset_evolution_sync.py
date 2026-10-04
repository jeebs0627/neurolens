"""Collect main history, deployment evidence and AI follow-ups. GitHub Actions entrypoint."""
import argparse
import base64
import json
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dataset_evolution_core import REPOSITORY, SCHEMA, LOG_PATH, changes, rule_tasks, fingerprint, domains

ENDPOINT = 'https://neurolens-xi.vercel.app/api/dataset_evolution'


def now():
    return datetime.now(timezone.utc).isoformat()


def git(*args):
    return subprocess.check_output(['git', '-c', 'core.quotePath=false', *args], cwd=ROOT).decode('utf-8', 'replace')


def github(path, method='GET', data=None, accept='application/vnd.github+json'):
    headers = {'Accept': accept, 'User-Agent': 'NeuroLens-dataset-evolution', 'X-GitHub-Api-Version': '2022-11-28'}
    if os.environ.get('GH_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
    req = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + path, method=method,
                                 headers=headers, data=json.dumps(data).encode() if data is not None else None)
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.load(response)


def empty():
    return {'schema': SCHEMA, 'repository': REPOSITORY, 'entries': [], 'coverage': {'branch': 'main', 'deploymentScope': 'latest-12-commits-and-delivery-events'}}


def repository_log():
    try:
        blob = github('/contents/' + LOG_PATH + '?ref=main')
        data = json.loads(base64.b64decode(blob['content'])) if blob.get('content') else github('/contents/' + LOG_PATH + '?ref=main', accept='application/vnd.github.raw+json')
        return data, blob['sha']
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        return empty(), None


def collect(existing):
    by_sha = {e['sha']: e for e in existing.get('entries', [])}
    commits = git('rev-list', '--reverse', 'HEAD').splitlines()
    for sha in commits:
        if sha in by_sha:
            continue
        numstat = git('show', '--format=', '--numstat', '--no-renames', sha)
        files = []
        for line in numstat.splitlines():
            parts = line.split('\t', 2)
            if len(parts) == 3:
                added, deleted, path = parts
                files.append({'path': path, 'additions': int(added) if added.isdigit() else None, 'deletions': int(deleted) if deleted.isdigit() else None})
        if files and all(f['path'] == LOG_PATH for f in files):
            continue  # Automation must not generate follow-ups for its own bookkeeping commits.
        stamp, parents, message = git('show', '-s', '--format=%cI%n%P%n%B', sha).split('\n', 2)
        entry = changes({'sha': sha, 'parents': parents.split(), 'committedAt': stamp, 'message': message}, files)
        if entry['domains']:
            paths = [f['path'] for f in files if domains([f]) and pathlib.PurePosixPath(f['path']).suffix in ('.js', '.py', '.html', '.sql')]
            patch = git('show', '--format=', '--no-ext-diff', '--unified=2', '--no-renames', sha, '--', *paths) if paths else ''
            entry['patchExcerpt'], entry['patchTruncated'] = patch[:24000], len(patch) > 24000
        entry.update({'tasks': rule_tasks(entry), 'analysisState': 'pending' if entry['domains'] else 'not-applicable',
                      'analysisAttempts': 0, 'deploymentEvents': []})
        by_sha[sha] = entry
    existing['entries'] = sorted(by_sha.values(), key=lambda e: (e['committedAt'] or '', e['sha']), reverse=True)
    existing['coverage']['sourceHead'] = git('rev-parse', 'HEAD').strip()
    return existing


def merge_events(old, new):
    events = {e['key']: e for e in old}
    events.update({e['key']: e for e in new})
    return sorted(events.values(), key=lambda e: (e.get('at') or '', e['key']))


def deployment_event(deployment, status):
    return {'key': 'deployment-' + str(deployment['id']) + '-' + str(status['id']), 'type': 'deployment',
            'deploymentId': deployment['id'], 'environment': deployment.get('environment'),
            'production': deployment.get('production_environment') is True,
            'state': status['state'], 'at': status.get('created_at'), 'url': status.get('log_url') or status.get('target_url'),
            'source': 'github-deployment-status'}


def sync_deployments(ledger):
    by_sha = {e['sha']: e for e in ledger['entries']}
    event_path = os.environ.get('GITHUB_EVENT_PATH')
    if event_path and os.environ.get('GITHUB_EVENT_NAME') == 'deployment_status':
        event = json.loads(pathlib.Path(event_path).read_text())
        dep, status = event.get('deployment', {}), event.get('deployment_status', {})
        if dep.get('sha') in by_sha and status.get('id'):
            row = by_sha[dep['sha']]
            row['deploymentEvents'] = merge_events(row.get('deploymentEvents', []), [deployment_event(dep, status)])
    for row in ledger['entries'][:12]:
        events = []
        # Commit status and actual production deployment remain distinct evidence types.
        for status in github('/commits/' + row['sha'] + '/statuses?per_page=100'):
            events.append({'key': 'check-' + str(status['id']), 'type': 'commit-status', 'context': status['context'],
                           'state': status['state'], 'at': status.get('created_at'), 'url': status.get('target_url'), 'source': 'github-commit-status'})
        for deployment in github('/deployments?sha=' + row['sha'] + '&per_page=10'):
            for status in github('/deployments/' + str(deployment['id']) + '/statuses?per_page=20'):
                events.append(deployment_event(deployment, status))
        row['deploymentEvents'] = merge_events(row.get('deploymentEvents', []), events)


def oidc_token():
    request_url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']
    request_url += ('&' if '?' in request_url else '?') + 'audience=neurolens_dataset_evolution'
    req = urllib.request.Request(request_url, headers={'Authorization': 'Bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)['value']


def ai_analyze(sha):
    req = urllib.request.Request(ENDPOINT, data=json.dumps({'sha': sha}).encode(),
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + oidc_token()})
    with urllib.request.urlopen(req, timeout=115) as response:
        return json.load(response)


def enrich(ledger, limit=3, retry_failed=False):
    attempted = 0
    for entry in ledger['entries']:
        if not entry['domains'] or entry.get('analysisState') == 'generated':
            continue
        if entry.get('analysisAttempts', 0) >= 5 and not retry_failed:
            continue
        last = entry.get('lastAttemptAt')
        if last and not retry_failed and datetime.fromisoformat(last) > datetime.now(timezone.utc) - timedelta(hours=1):
            continue
        if attempted >= limit:
            break
        attempted += 1
        entry['analysisAttempts'] = entry.get('analysisAttempts', 0) + 1
        entry['lastAttemptAt'] = now()
        try:
            result = ai_analyze(entry['sha'])
            if result.get('sourceSha') != entry['sha'] or not result.get('tasks'):
                raise ValueError('invalid analysis response')
            entry['analysis'], entry['analysisState'] = result, 'generated'
            entry['tasks'] = result['tasks']
            entry.pop('analysisError', None)
        except urllib.error.HTTPError as error:
            # Persist a safe machine status, never provider text, tokens or identity claims.
            entry['analysisState'], entry['analysisError'] = 'retry-pending', 'HTTP_' + str(error.code)
        except Exception:
            entry['analysisState'], entry['analysisError'] = 'retry-pending', 'ANALYSIS_UNAVAILABLE'
        print('analysis', entry['sha'][:12], entry['analysisState'])


def merge_ledgers(latest, incoming):
    merged = {e['sha']: e for e in latest.get('entries', [])}
    for entry in incoming['entries']:
        old = merged.get(entry['sha'])
        if old:
            events = merge_events(old.get('deploymentEvents', []), entry.get('deploymentEvents', []))
            if old.get('analysisState') == 'generated' and entry.get('analysisState') != 'generated':
                entry = {**entry, 'analysis': old['analysis'], 'tasks': old['tasks'], 'analysisState': 'generated'}
            entry['deploymentEvents'] = events
        merged[entry['sha']] = entry
    return {**incoming, 'entries': sorted(merged.values(), key=lambda e: (e['committedAt'] or '', e['sha']), reverse=True)}


def material(ledger):
    return {k: v for k, v in ledger.items() if k not in ('updatedAt', 'coverage')}


def publish(ledger):
    for _ in range(3):
        latest, blob_sha = repository_log()
        merged = merge_ledgers(latest, ledger)
        if fingerprint(material(latest)) == fingerprint(material(merged)):
            print('No new code, deployment or analysis evidence; no bookkeeping commit.')
            return
        merged['updatedAt'] = now()
        body = {'message': 'chore(dataset): accumulate code and deployment evidence', 'branch': 'main',
                'content': base64.b64encode((json.dumps(merged, ensure_ascii=False, indent=2) + '\n').encode()).decode()}
        if blob_sha:
            body['sha'] = blob_sha
        try:
            github('/contents/' + LOG_PATH, method='PUT', data=body)
            print('Published dataset evolution evidence:', len(merged['entries']), 'commits')
            return
        except urllib.error.HTTPError as error:
            if error.code not in (409, 422):
                raise
    raise RuntimeError('Concurrent ledger update; retry this workflow')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--ai-limit', type=int, default=3)
    args = parser.parse_args()
    if args.publish:
        ledger, _ = repository_log()
    else:
        file = ROOT / LOG_PATH
        ledger = json.loads(file.read_text(encoding='utf-8')) if file.exists() else empty()
    ledger = collect(ledger)
    if not args.offline:
        try:
            sync_deployments(ledger)
        except Exception:
            print('Deployment polling incomplete; preserved previously observed states.')
        enrich(ledger, args.ai_limit, os.environ.get('RETRY_FAILED') == 'true')
    if args.publish:
        publish(ledger)
    else:
        ledger['updatedAt'] = now()
        (ROOT / LOG_PATH).write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print('Collected', len(ledger['entries']), 'code commits')


if __name__ == '__main__':
    main()
