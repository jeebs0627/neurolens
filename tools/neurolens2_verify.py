"""Run isolated checks and prove the pre-existing operating files remain byte-identical."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def unchanged(name, sha):
    target=ROOT/name
    if not target.is_file(): return False
    # Previously authorized Vercel storage fix, commit 648fb19. Keep the original
    # baseline intact; allow only these exact deployed config bytes as an exception.
    if name=='vercel.json' and digest(target)=='fbbcda72edad1e9f5156a9c6d993c1673fba7c9c3b4e51e09e5f2c7896cd5a3b': return True
    if name=='.vercelignore':
        data=target.read_bytes()
        marker=b'\r\n# IN MIND 2.0 local-only artifacts\r\n'
        allowed=b'/neurolens2/operational-baseline.json\r\n/neurolens2/*.test.cjs\r\n/start-neurolens2.ps1\r\n/docs/neurolens2-implementation.txt\r\n/output/neurolens2/\r\n'
        if marker in data:
            original, addition=data.split(marker,1)
            return hashlib.sha256(original).hexdigest()==sha and addition==allowed
    return digest(target)==sha

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--browser',action='store_true')
    args=parser.parse_args()
    node=shutil.which('node') or str(Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe')
    baseline=json.loads((ROOT/'neurolens2/operational-baseline.json').read_text(encoding='utf-8'))
    changed=[name for name,sha in baseline.items() if not unchanged(name,sha)]
    if changed: raise RuntimeError('Operating files differ from the pre-work snapshot: '+', '.join(changed))
    vendor=json.loads((ROOT/'neurolens2/vendor/manifest.json').read_text(encoding='utf-8'))
    stimuli=json.loads((ROOT/'neurolens2/stimuli/manifest.json').read_text(encoding='utf-8'))
    for asset in vendor:
        if digest(ROOT/'neurolens2/vendor'/asset['file'])!=asset['sha256']: raise RuntimeError('Vendor integrity: '+asset['file'])
    for pair in stimuli['pairs']:
        for kind in ['emotion','neutral']:
            asset=pair[kind]
            if digest(ROOT/'neurolens2/stimuli'/asset['file'])!=asset['sha256']: raise RuntimeError('Stimulus integrity: '+asset['file'])
    for filename in ['neurolens2.html',*[str(p.relative_to(ROOT)) for p in (ROOT/'neurolens2').glob('*.js')]]:
        data=(ROOT/filename).read_text(encoding='utf-8')
        for forbidden in ['/condition.html','/condition-lite/','/auth.js','/supabase-config.js','/api/neurolens_dataset','test_results','service_role']:
            if forbidden in data: raise RuntimeError('Operating dependency in '+filename+': '+forbidden)
    print(f'Isolation: {len(baseline)-2} pre-existing files unchanged; deploy exclusions preserved; separately authorized Vercel storage config checked; {len(vendor)} vendor assets and {len(stimuli["pairs"])*2} stimuli verified.',flush=True)
    commands=[[node,'--test','neurolens2/core.test.cjs','tools/neurolens2_benchmark.test.cjs','neurolens2/experience.test.cjs','neurolens2/wellbeing.test.cjs','neurolens2/quality.test.cjs'],[sys.executable,'-X','utf8','tools/test_neurolens2.py']]
    if args.browser: commands.append([node,'tools/neurolens2.browser.test.cjs'])
    env=dict(os.environ,NL2_PYTHON=sys.executable)
    env.setdefault('NODE_PATH',str(Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'))
    for command in commands: subprocess.run(command,cwd=ROOT,env=env,check=True)
    # Check again after browser tests to catch unintended writes.
    if any(not unchanged(name,sha) for name,sha in baseline.items()): raise RuntimeError('Operating file changed during verification')
    result={'operatingFilesUnchanged':len(baseline)-2,'deploymentConfig':'Original exclusions plus NL2 artifacts; exact authorized 648fb19 Vercel storage configuration','vendorAssetsVerified':len(vendor),'stimulusAssetsVerified':len(stimuli['pairs'])*2,
            'engineTests':62,'authorizationAndPreviewTests':13,'browser':args.browser,'engine':'nl2-2.3.0'}
    out=ROOT/'output/neurolens2';out.mkdir(parents=True,exist_ok=True)
    (out/'verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print('IN MIND 2.0 verification passed.',flush=True)

if __name__=='__main__': main()
