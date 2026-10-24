"""Offline checks for deployment exclusions and canonical URLs. No credentials needed."""
import ast
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SITE = 'https://www.neurolens.me'


def git(*args, cwd=ROOT, data=None):
    return subprocess.run(['git', *args], cwd=cwd, input=data, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=True).stdout


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.tags = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


def main():
    files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').decode().split('\0')
    files = sorted(set(filter(None, files)))
    private = [
        'newbiz-core.test.js', 'condition-signal.test.cjs', 'api/rppg_test.py',
        'api/test_future.py', 'api/__pycache__/gemini.cpython-312.pyc',
        'docs/internal.txt', 'output/report.json', 'tmp/notes.html',
        '뉴로렌즈_출원1_정규출원세트/초안.docx', '뉴로렌즈_출원2_정규출원세트/검토.json',
        '보완검토.txt', 'future-private-folder/export.json', 'internal.docx',
        '.env', '.env.production', 'gemini.key', 'api/private.pem',
        '.newbiz2-local/measurements.sqlite3', '.newbiz2-venv/pyvenv.cfg',
        'supabase/migrations/internal.sql', 'research_export/participants.json',
        'training/snapshot.json', 'notebooks/train.ipynb', 'node_modules/pkg/index.js',
        'start-newbiz2.ps1', 'newbiz2_server.py', 'newbiz2-benchmark.cjs',
        'NeuroLens_PRD_private.html', 'neurolens2/operational-baseline.json',
    ]
    public = [
        'index.html', 'condition.html', 'test.html', 'admin.html', 'report.html',
        'auth.js', 'care.js', 'condition-camera.js', 'condition-analysis-worker.js',
        'newbiz-core.js', 'dataset-workspace.js', 'dataset-deploy-guard.cjs',
        'dataset_evolution_core.py', 'requirements.txt', 'vercel.json',
        'api/gemini.py', 'api/dataset_evolution.py', 'api/neurolens_dataset.py',
        'model-registry.json', 'release_policy.json', 'training-ledger.json',
        'dataset-engine-log.json', 'dataset-evolution-log.json',
        'models/gaze/model/model.onnx', 'models/gaze/model/manifest.json',
        'newbiz-stim/A/image.jpg', 'newbiz-stim/manifest.json',
        'neurolens2/app.js', 'neurolens2/vendor/vision_wasm_internal.wasm',
        'neurolens2/vendor/MEDIAPIPE-LICENSE.txt', 'img/og-cover.png',
        'robots.txt', 'sitemap.xml',
    ]
    candidates = sorted(set(files + private + public))
    with tempfile.TemporaryDirectory(prefix='neurolens-deploy-check-') as folder:
        git('init', '--quiet', cwd=folder)
        Path(folder, '.gitignore').write_bytes((ROOT / '.vercelignore').read_bytes())
        # Git and .vercelignore use ordered ignore/negation rules. Exit 1 means no matches.
        result = subprocess.run(['git', 'check-ignore', '--no-index', '-z', '--stdin'],
                                cwd=folder, input=('\0'.join(candidates) + '\0').encode(),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert result.returncode in (0, 1), result.stderr.decode()
        excluded = set(filter(None, result.stdout.decode().split('\0')))
    assert set(private) <= excluded, f'Private files allowed: {set(private) - excluded}'
    assert not set(public) & excluded, f'Service files excluded: {set(public) & excluded}'

    def check_dependency(source, value):
        parts = urlsplit(value)
        if parts.scheme or parts.netloc or not parts.path:
            return
        path = unquote(parts.path)
        target = (ROOT / path.lstrip('/') if path.startswith('/') else ROOT / source.parent / path)
        if target.is_file() and target.is_relative_to(ROOT):
            relative = target.relative_to(ROOT).as_posix()
            assert relative not in excluded, f'{source} requires excluded file {relative}'

    for name in files:
        if name in excluded:
            continue
        source = Path(name)
        if source.suffix not in ('.html', '.js', '.css', '.py'):
            continue
        text = (ROOT / source).read_text(encoding='utf-8-sig')
        if source.suffix == '.html':
            for _, attrs in Page(text).tags:
                for key in ('src', 'href', 'poster'):
                    if key in attrs:
                        check_dependency(source, attrs[key])
        for value in re.findall(r'''(?:fetch\(\s*|from\s+|import\(\s*)['"]([^'"\n]+)['"]''', text):
            check_dependency(source, value)
        for value in re.findall(r'''url\(\s*['"]?([^)'"\s]+)''', text):
            check_dependency(source, value)
        if source.suffix == '.py':
            for node in ast.walk(ast.parse(text)):
                if isinstance(node, ast.ImportFrom) and node.module:
                    check_dependency(Path('index.html'), node.module.replace('.', '/') + '.py')

    for name, canonical in [('index.html', SITE + '/'), ('condition.html', SITE + '/condition')]:
        text = (ROOT / name).read_text(encoding='utf-8-sig')
        canonicals = [a.get('href') for tag, a in Page(text).tags
                      if tag == 'link' and a.get('rel') == 'canonical']
        assert canonicals == [canonical], (name, canonicals)
        assert 'neurolens-xi.vercel.app' not in text, name
    index = (ROOT / 'index.html').read_text(encoding='utf-8-sig')
    for tag, attrs in Page(index).tags:
        if tag == 'meta' and (attrs.get('property') == 'og:url'):
            assert attrs['content'] == SITE + '/'
        if tag == 'meta' and (attrs.get('property') == 'og:image' or attrs.get('name') == 'twitter:image'):
            assert attrs['content'] == SITE + '/img/og-cover.png'
    data = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', index, re.S).group(1))
    assert all(item['url'] == SITE + '/' for item in data['@graph'])
    sitemap = ET.parse(ROOT / 'sitemap.xml')
    locations = [n.text for n in sitemap.findall('.//{*}loc')]
    assert locations == [SITE + '/', SITE + '/condition'], locations
    assert f'Sitemap: {SITE}/sitemap.xml' in (ROOT / 'robots.txt').read_text(encoding='utf-8')
    config = json.loads((ROOT / 'vercel.json').read_text(encoding='utf-8'))
    for route in config['rewrites']:
        target = urlsplit(route['destination']).path.lstrip('/')
        if target.startswith('api/'):
            target += '.py'
        assert (ROOT / target).is_file() and target not in excluded, target
    print(f'PASS: {len(private)} private paths excluded; {len(public)} service paths retained; '
          f'{len(files)} repository files checked for asset dependencies; canonical URLs consistent')


if __name__ == '__main__':
    main()
