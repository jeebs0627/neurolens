"""GitHub Actions OIDC-authenticated public-code analysis. No participant data."""
import json
import os
import re
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

import jwt
from api.neurolens_dataset import RequestError, generate
from dataset_evolution_core import REPOSITORY, REPOSITORY_ID, changes, validate_analysis, domains

AUDIENCE = 'neurolens_dataset_evolution'
ISSUER = 'https://token.actions.githubusercontent.com'
WORKFLOW = REPOSITORY + '/.github/workflows/dataset-evolution.yml@refs/heads/main'
JWKS = jwt.PyJWKClient(ISSUER + '/.well-known/jwks', timeout=10)


def authorize(token):
    try:
        key = JWKS.get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=['RS256'], audience=AUDIENCE, issuer=ISSUER,
                            options={'require': ['exp', 'iat', 'nbf', 'sub', 'repository_id', 'repository', 'ref', 'workflow_ref']})
        if (claims['repository_id'] != REPOSITORY_ID or claims['repository'] != REPOSITORY
                or claims['ref'] != 'refs/heads/main' or claims['workflow_ref'] != WORKFLOW
                or claims['sub'] != 'repo:' + REPOSITORY + ':ref:refs/heads/main'
                or claims.get('event_name') not in ('push', 'schedule', 'deployment_status', 'workflow_dispatch')):
            raise ValueError('untrusted workflow')
        return claims
    except Exception:
        raise RequestError(403, '등록된 GitHub 자동화만 호출할 수 있습니다.', 'EVOLUTION_WORKFLOW_DENIED') from None


def commit_evidence(sha):
    if not isinstance(sha, str) or not re.fullmatch('[a-f0-9]{40}', sha):
        raise RequestError(400, '유효한 커밋 SHA가 필요합니다.')
    # Fixed repository and URL. The request body cannot supply a diff, URL or prompt.
    req = urllib.request.Request(f'https://api.github.com/repos/{REPOSITORY}/commits/{sha}?per_page=100',
                                 headers={'User-Agent': 'NeuroLens-dataset-evolution', 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(req, timeout=12) as response:
        data = json.load(response)
        truncated = 'rel="next"' in response.headers.get('Link', '')
    files = data.get('files', [])
    commit = {'sha': data['sha'], 'parents': [p['sha'] for p in data.get('parents', [])],
              'committedAt': data['commit']['committer']['date'], 'message': data['commit']['message'], 'filesTruncated': truncated}
    patch = '\n'.join(f"FILE {f['filename']}\n{f.get('patch', '[patch unavailable]')}" for f in files
                      if domains([{'path': f['filename']}]) and f['filename'].rsplit('.', 1)[-1] in ('js', 'py', 'html', 'sql'))
    return changes(commit, [{'path': f['filename'], 'status': f['status'], 'additions': f['additions'], 'deletions': f['deletions']} for f in files], patch)


def analyze(sha, claims):
    entry = commit_evidence(sha)
    if not entry['domains']:
        raise RequestError(400, '분석할 알고리즘·연구 영역 변경이 없습니다.')
    key = os.environ.get('neurolens_dataset', '').strip()
    if not key:
        raise RequestError(503, 'neurolens_dataset 환경변수가 없습니다.', 'DATASET_KEY_MISSING')
    instruction = '''공개 GitHub 코드 변경을 근거로 후속 개발·검증 과제를 작성하라. JSON 객체만 반환한다.
형식: {"summary":"관측된 변경과 미검증 영향 요약", "tasks":[{"domain":"제공된 domains 중 하나", "title":"후속 과제", "rationale":"변경 근거와 가설 구분", "validationPlan":"회귀·실측 검증 계획", "prompt":"개발 AI에 전달할 완결된 한국어 프롬프트"}]}.
domain별 최대 한 과제, 전체 1~4개. summary는 4000자, title 160자, rationale 2000자, validationPlan 3000자, prompt 14000자 이하.
실제 변경 파일과 제공된 diff 범위만 근거로 사용한다. diff 생략은 명시하라. 커밋 제목을 검증된 성과로 취급하지 마라.
프롬프트에는 현재 코드 확인, 부분 유효 신호 활용량과 오차를 함께 평가하는 변경·검증 과제, 성공/회귀 기준, 결과 보고 양식을 포함하라.
실측은 이 자료에 포함되어 있지 않다. dataset에서 관련 실측·메모를 연결해 판단하도록 요구하고 실측 성능 수치를 만들어내지 마라.'''
    text, provenance = generate({'publicCodeChange': entry}, instruction, key, json_output=True)
    try:
        result = validate_analysis(json.loads(text), entry)
    except (ValueError, TypeError):
        raise RequestError(502, '자동 과제 JSON 검증에 실패했습니다.', 'EVOLUTION_INVALID_AI_OUTPUT') from None
    result.update({'provenance': provenance, 'generatedAt': datetime.now(timezone.utc).isoformat(),
                   'sourceSha': sha, 'sourceEvidence': entry, 'workflowRunId': claims.get('run_id')})
    return result


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            auth = self.headers.get('Authorization', '')
            if not re.fullmatch(r'Bearer [A-Za-z0-9_.-]{20,16000}', auth):
                raise RequestError(401, 'GitHub 자동화 인증이 필요합니다.')
            claims = authorize(auth[7:])
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 200:
                raise RequestError(400, '요청 크기가 올바르지 않습니다.')
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict) or set(body) != {'sha'}:
                raise RequestError(400, '커밋 SHA만 전송하세요.')
            self.send_json(200, analyze(body['sha'], claims))
        except RequestError as error:
            self.send_json(error.status, {'error': error.message, 'code': error.code, 'retryable': error.retryable})
        except Exception:
            self.send_json(502, {'error': '변경 분석에 실패했습니다. 다음 자동 동기화에서 재시도합니다.', 'code': 'EVOLUTION_ANALYSIS_FAILED'})

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
