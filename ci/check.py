"""Run release checks before producing the only directory Vercel may publish."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
from public_files import publishable

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
env=os.environ.copy()
env['PYTHONPATH']=str(ROOT/'.ci-python')+os.pathsep+str(ROOT)
env['DATASET_PGLITE_PATH']=str(ROOT/'ci/node_modules/@electric-sql/pglite')

def run(*args):
    print('+',' '.join(args),flush=True)
    subprocess.run(args,env=env,check=True)

for test in ['ci/care_preview_test.py','ci/rppg_test.py','ci/ai_guard_test.py']:
    run(sys.executable,'-B',test)
for test in ['dataset-deploy-guard.test.cjs','newbiz-core.test.js','newbiz-battery.test.js',
             'condition-signal.test.cjs','condition-fusion.test.cjs','condition-gaze-model.test.cjs',
             'tools/profile_role_security_test.cjs','tools/ai_guard_sql_test.cjs']:
    run('node',test)
run(sys.executable,'-B','tools/deployment_safety_test.py')
run('node','ci/browser.test.cjs')

output=(ROOT/'.site').resolve()
assert output.parent==ROOT and output.name=='.site'
if output.exists():shutil.rmtree(output)
output.mkdir()
for parent,dirs,files in os.walk(ROOT):
    relative=Path(parent).relative_to(ROOT)
    dirs[:]=[name for name in dirs if (not relative.parts and name in {'img','models','newbiz-stim','neurolens2'}) or
             (relative.parts and not name.startswith('.') and name!='node_modules')]
    for name in files:
        path=relative/name
        if publishable(path.as_posix()):
            target=output/path;target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(ROOT/path,target)
assert not list(output.rglob('*.py')) and not list(output.rglob('*.cjs'))
print('PASS all release checks; static publish directory created',flush=True)
