"""Public-code evidence only. Shared by collection and the authenticated AI endpoint."""
import hashlib
import json
import re

REPOSITORY = 'jeebs0627/neurolens'
REPOSITORY_ID = '1298301713'
SCHEMA = 'dataset-evolution-1'
RULE_VERSION = 'evolution-followup-1'
LOG_PATH = 'dataset-evolution-log.json'
DOMAINS = {
    'pulse': ('맥파·신호 융합', ('condition-signal', 'condition-fusion', 'newbiz-core', 'phone-ppg')),
    'gaze': ('시선·카메라 획득', ('condition-camera', 'newbiz-battery')),
    'measurement': ('검사·해석', ('condition.html', 'newbiz-report', 'newbiz-battery')),
    'research': ('데이터·연구 자동화', ('dataset', 'condition-dataset', 'condition-research', 'newbiz-research', 'supabase/', 'api/neurolens_dataset', 'api/dataset_evolution', '.github/workflows/dataset-evolution')),
}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def fingerprint(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def domains(files):
    paths = [f['path'] for f in files]
    return [key for key, (_, prefixes) in DOMAINS.items()
            if any(any(path.startswith(prefix) or path.rsplit('/', 1)[-1].startswith(prefix) for prefix in prefixes) for path in paths)]


def changes(commit, files, patch=''):
    sha = commit['sha']
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('invalid commit SHA')
    clean = [{'path': f['path'], 'status': f.get('status', 'modified'),
              'additions': f.get('additions'), 'deletions': f.get('deletions')} for f in files]
    scopes = domains(clean)
    refs = re.findall(r'(?im)^Dataset-Task:\s*(evo-[a-f0-9]{12}-[a-z]+)\s*$', commit.get('message', ''))
    return {'sha': sha, 'parents': commit.get('parents', []), 'committedAt': commit.get('committedAt'),
            'subject': commit.get('message', '').split('\n', 1)[0][:500],
            'url': f'https://github.com/{REPOSITORY}/commit/{sha}', 'files': clean,
            'domains': scopes, 'linkedTaskIds': sorted(set(refs)), 'patchExcerpt': patch[:24000],
            'patchTruncated': len(patch) > 24000, 'filesTruncated': bool(commit.get('filesTruncated')),
            'evidenceType': 'source-change', 'accuracyValidated': False}


def evidence_hash(entry):
    return fingerprint({k: entry.get(k) for k in ('sha', 'parents', 'files', 'subject', 'patchExcerpt', 'patchTruncated', 'filesTruncated')})


def rule_tasks(entry):
    tasks = []
    plans = {
        'pulse': '저조도·움직임·짧은 유효 구간에서 활용 시간과 기준 심박 MAE/RMSE를 함께 비교한다. 중복 분석 창을 독립 표본으로 세지 않는다.',
        'gaze': '안경 반사·모자·단안 가림·프레임 지연에서 유효 시선 표본 비율과 독립 표적 오차를 비교한다. 보정 학습 표적을 독립 평가 정답으로 쓰지 않는다.',
        'measurement': '부분 완료·중단·오류를 포함해 측정 성공률과 제외 지표를 확인한다. 자극/입력 지연, 결과 해석의 불확실성과 회귀를 비교한다.',
        'research': '권한·동의·철회·중복 재시도·원문 보존을 검증한다. 변경 출처와 실측 연결, 프롬프트 생성 실패 복구를 재현한다.',
    }
    for domain in entry['domains']:
        task_id = 'evo-' + entry['sha'][:12] + '-' + domain
        title = DOMAINS[domain][0] + ' 변경 후 회귀·실측 검증'
        prompt = (f"NeuroLens 알고리즘 후속 과제 {task_id}\n저장소: https://github.com/{REPOSITORY}\n"
                  f"기준 변경: {entry['sha']}\n변경 제목: {entry['subject']}\n"
                  f"관련 파일: {', '.join(f['path'] for f in entry['files'][:25])}\n"
                  '현재 main과 최근 다른 개발자의 변경을 먼저 확인하고 원본 실측값을 유지하면서 개선하라.\n'
                  f"검증 계획: {plans[domain]}\n"
                  '실측 검토에서 관련 검사·메모를 연결하고 관측 사실과 원인 가설을 구분하라. 기준값이 없으면 정확도 미검증으로 남겨라. '
                  '배포 성공이나 커밋 설명만으로 성능 향상을 확정하지 말라. 실패 시도를 분모에 유지하고 활용률과 오차의 균형을 평가하라.\n'
                  '보고: 수정 파일, 실제 커밋, 엔진 전후 버전, 실행한 테스트와 수치/표본/조건, 미실시 항목, 후속 과제.\n'
                  f"이 과제를 처리한 커밋 본문에 다음 연결 표식을 추가하라: Dataset-Task: {task_id}\n"
                  '검사 코드·개인 메모·실측값은 공개 GitHub 커밋에 넣지 말고 dataset 조치란에 기록하라.')
        tasks.append({'id': task_id, 'domain': domain, 'title': title, 'rationale': '해당 영역의 코드 변경이 관측됨. 효과는 아직 검증하지 않음.',
                      'validationPlan': plans[domain], 'prompt': prompt, 'generator': 'rule', 'state': 'proposed'})
    return tasks


def validate_analysis(value, entry):
    if not isinstance(value, dict) or not isinstance(value.get('summary'), str) or not 1 <= len(value['summary']) <= 4000:
        raise ValueError('invalid AI summary')
    raw = value.get('tasks')
    if not isinstance(raw, list) or not 1 <= len(raw) <= 4:
        raise ValueError('invalid AI tasks')
    seen, tasks = set(), []
    for item in raw:
        if not isinstance(item, dict) or item.get('domain') not in entry['domains'] or item['domain'] in seen:
            raise ValueError('invalid AI task domain')
        seen.add(item['domain'])
        task = {'id': 'evo-' + entry['sha'][:12] + '-' + item['domain'], 'domain': item['domain'], 'generator': 'gemini', 'state': 'proposed'}
        for key, limit in (('title', 160), ('rationale', 2000), ('validationPlan', 3000), ('prompt', 14000)):
            v = item.get(key)
            if not isinstance(v, str) or not v.strip() or len(v) > limit:
                raise ValueError('invalid AI task field')
            task[key] = v.strip()
        task['prompt'] += (f"\n\n[추적 연결]\nRepository: {REPOSITORY}\nSource commit: {entry['sha']}\n"
                           f"Dataset-Task: {task['id']}\n이 표식을 후속 변경 커밋 본문에 포함하고 실측값·개인 메모는 공개 GitHub에 기록하지 마세요. "
                           '배포 성공과 사람 대상 정확도 검증을 구분하세요.')
        tasks.append(task)
    # Never silently drop a domain from the automatic follow-up queue.
    tasks.extend(t for t in rule_tasks(entry) if t['domain'] not in seen)
    return {'summary': value['summary'].strip(), 'tasks': tasks, 'evidenceHash': evidence_hash(entry),
            'ruleVersion': RULE_VERSION, 'accuracyValidated': False}
