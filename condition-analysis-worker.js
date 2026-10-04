/* Numeric-only live evidence analysis; keeps the video capture thread responsive. */
importScripts('condition-signal.js','condition-fusion.js','newbiz-core.js');
self.onmessage=({data:m})=>{
  try{self.postMessage({id:m.id,key:m.key,start:m.start,evidence:NLNewbiz.measureEvidence(m.frames,m.start,m.end)});}
  catch(e){self.postMessage({id:m.id,key:m.key,start:m.start,error:String(e.message||e)});}
};
