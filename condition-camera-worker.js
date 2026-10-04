/* Classic worker: MediaPipe's WASM loader may use importScripts internally. */
importScripts('condition-signal.js');
let detector, canvas, ctx, skinCanvas, skinCtx;
self.onmessage = async ({data:m}) => {
  try {
    if(m.type==='init') {
      const {FaceLandmarker,FilesetResolver}=await import(m.base+'/vision_bundle.mjs');
      const files=await FilesetResolver.forVisionTasks(m.base+'/wasm');
      const opts=delegate=>({baseOptions:{modelAssetPath:m.model,delegate},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true});
      try { detector=await FaceLandmarker.createFromOptions(files,opts('GPU')); }
      catch (_) { detector=await FaceLandmarker.createFromOptions(files,opts('CPU')); }
      canvas=new OffscreenCanvas(640,480);ctx=canvas.getContext('2d',{willReadFrequently:true});
      skinCanvas=new OffscreenCanvas(320,240);skinCtx=skinCanvas.getContext('2d',{willReadFrequently:true});
      self.postMessage({type:'ready'});return;
    }
    if(m.type!=='frame')return;
    const bmp=m.bitmap;
    try {
      const w=Math.min(640,bmp.width),h=Math.round(bmp.height*w/bmp.width);
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
      ctx.drawImage(bmp,0,0,w,h);
      const gain=NLSignal.exposureGain(ctx);
      // Keep the original pixels for quality and pulse extraction.
      const raw=gain>1.05?ctx.getImageData(0,0,w,h):null;
      NLSignal.enhance(ctx,gain);
      const result=detector.detectForVideo(canvas,m.t);
      if(raw)ctx.putImageData(raw,0,0);
      const lm=result.faceLandmarks?.[0];
      const sh=Math.round(320*bmp.height/bmp.width);
      if(skinCanvas.height!==sh)skinCanvas.height=sh;
      skinCtx.drawImage(bmp,0,0,320,sh);
      const skin=NLSignal.sampleSkin(skinCtx,lm);
      const eyes=lm?{left:NLSignal.eyeQuality(ctx,lm,[362,263,386,374]),right:NLSignal.eyeQuality(ctx,lm,[33,133,159,145])}:null;
      self.postMessage({type:'result',t:m.t,result,skin,eyes,gain});
    } finally {bmp.close();}
  } catch(e) {self.postMessage({type:'error',message:String(e.message||e)});}
};
