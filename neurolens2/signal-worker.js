importScripts('pulse.js');
self.onmessage=({data})=>{try{
  const {frames,start,end,phase}=data;
  const result=NL2Pulse.windowEvidence(frames,start,end,phase,{temporal:true});
  self.postMessage({phase,end,bpm:result.bpm,reason:result.reason,waveform:result.waveform||[],observedFrames:result.source.observedFrames});
}catch{self.postMessage({phase:data.phase,end:data.end,bpm:null,reason:'신호 분석을 완료하지 못했습니다.',waveform:[]});}};
