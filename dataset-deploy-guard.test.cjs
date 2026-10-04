const assert=require('node:assert/strict'),{shouldSkip}=require('./dataset-deploy-guard.cjs'),sha='a'.repeat(40);
assert.equal(shouldSkip(sha,()=> 'dataset-evolution-log.json\n'),true);
assert.equal(shouldSkip(sha,()=> 'dataset-evolution-log.json\ncondition-camera.js\n'),false);
assert.equal(shouldSkip('',()=> 'dataset-evolution-log.json'),false);
assert.equal(shouldSkip(sha,()=> ''),false);
assert.equal(shouldSkip(sha,()=>{throw Error('missing history')}),false);
console.log('PASS ledger-only build skip; undeployed code, manual redeploy and missing baseline still build');
