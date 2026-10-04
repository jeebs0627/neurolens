'use strict';
const {execFileSync}=require('node:child_process');
function shouldSkip(previous,readDiff){
  // Compare against the last successfully deployed SHA, not just HEAD's parent.
  // A bookkeeping push must not accidentally suppress still-undeployed code.
  if(!/^[a-f0-9]{40}$/.test(previous||''))return false;
  try{const files=readDiff(previous).trim().split(/\r?\n/).filter(Boolean);return files.length>0&&files.every(f=>f==='dataset-evolution-log.json');}catch(_){return false;}
}
if(require.main===module){
  const skip=shouldSkip(process.env.VERCEL_GIT_PREVIOUS_SHA,sha=>execFileSync('git',['diff','--name-only',sha,'HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
  console.log(skip?'Dataset ledger only: use the live GitHub record without rebuilding.':'Code or unconfirmed deployment baseline: build.');
  process.exit(skip?0:1);
}
module.exports={shouldSkip};
