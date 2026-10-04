/* Capture remains on the video clock; inference has a single transferable frame in flight.
 * No video/image leaves this browser. Stale geometry is never used past 180 ms. */
(function(root){
  'use strict';
  class Camera {
    constructor(video,opt){
      this.video=video;this.opt=opt;this.busy=false;this.stopped=false;this.lastT=0;this.geometry=null;
      this.canvas=document.createElement('canvas');this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});
      this.info={version:'condition-camera-3',backend:'initializing',captured:0,inferred:0,skipped:0,errors:0,fallbackReason:null};
    }
    async init(){
      /* 기본은 주 스레드 GPU 추론(동영상 프레임마다 직접 추론). 워커 경로는 기기에 따라 초당 7회 수준까지 떨어져
       * 시선 표본과 피부 영역 위치가 부족해지는 것이 실측 세션에서 확인돼, 명시적으로 요청할 때(?camworker=1)만 쓴다 */
      if(this.opt.preferMain!==false){
        try{await this.loadFallback();this.info.fallbackReason='main-thread-preferred';return;}
        catch(e){this.info.fallbackReason='main-thread-failed:'+String(e.message||e);}
      }
      if(typeof Worker==='function' && typeof createImageBitmap==='function' && typeof OffscreenCanvas==='function'){
        try {
          await new Promise((resolve,reject)=>{
            this.worker=new Worker('condition-camera-worker.js');
            const timer=setTimeout(()=>reject(new Error('worker-init-timeout')),20000);
            this.worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message||'worker-init-error'));};
            this.worker.onmessage=({data:m})=>{if(m.type==='ready'){clearTimeout(timer);resolve();}else if(m.type==='error'){clearTimeout(timer);reject(new Error(m.message));}};
            this.worker.postMessage({type:'init',base:this.opt.base,model:this.opt.model});
          });
          this.worker.onmessage=({data:m})=>{
            if(m.type==='error'){this.fallback(m.message);return;}
            if(m.type!=='result'||!this.pending||m.t!==this.pending.fr.t)return;
            clearTimeout(this.watchdog);const pending=this.pending;this.pending=null;this.busy=false;
            this.deliver(pending,m);
          };
          this.worker.onerror=e=>this.fallback(e.message||'worker-runtime-error');
          this.info.backend='worker';return;
        }catch(e){this.info.fallbackReason=String(e.message||e);this.worker?.terminate();this.worker=null;}
      }
      await this.loadFallback();
    }
    async loadFallback(){
      this.info.backend='loading-fallback';
      const detector=await this.opt.loadFallback();
      if(this.stopped){detector.close();return;}
      this.detector=detector;
      this.inferCanvas=document.createElement('canvas');this.inferCtx=this.inferCanvas.getContext('2d',{willReadFrequently:true});
      this.info.backend='main-thread';
    }
    async fallback(reason){
      if(this.info.backend==='loading-fallback'||this.stopped)return;
      clearTimeout(this.watchdog);this.worker?.terminate();this.worker=null;this.pending=null;this.busy=false;
      this.geometry=null;this.info.errors++;this.info.fallbackReason=reason;
      try {await this.loadFallback();}catch(e){this.info.backend='unavailable';this.opt.onError?.(e);}
    }
    deliver(pending,m){
      if(this.stopped)return;
      const lm=m.result.faceLandmarks?.[0];
      this.geometry=lm?{lm,t:m.t}:null;this.info.inferred++;
      this.opt.onResult(pending.fr,m,pending.context);
    }
    capture(meta){
      if(this.stopped||!this.video.videoWidth)return;
      const tp=performance.now();
      const captured=Number.isFinite(meta?.captureTime)&&meta.captureTime<=tp&&tp-meta.captureTime<400;
      let t=captured?meta.captureTime:tp;
      const intervalMs=this.lastT?t-this.lastT:null;
      t=Math.max(t,this.lastT+.01);this.lastT=t;
      const w=320,h=Math.round(w*this.video.videoHeight/this.video.videoWidth);
      if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
      this.ctx.drawImage(this.video,0,0,w,h);
      const age=this.geometry?t-this.geometry.t:Infinity;
      /* 얼굴 위치(랜드마크)가 조금 묵어도(≤600ms) 피부 영역은 거의 그대로이므로 버리지 않고 나이만큼 품질을 낮춘다 */
      const ageW=age<=100?1:age<=600?1-(age-100)/650:0;
      const skin=NLSignal.sampleSkin(this.ctx,ageW>0?this.geometry.lm:null);
      const fr={t,ok:skin.n>=12,ppgOk:skin.n>=12,skinOk:skin.n>=12,faceOk:false,eyeOk:false,gazeOk:false,
        ...skin,skinQ:skin.q*ageW,roiWeight:ageW,roiAge:Number.isFinite(age)?age:null,source:'tracked-roi',
        clockSource:captured?'capture':'callback',intervalMs,captureDelayMs:captured?tp-meta.captureTime:null,
        callbackLateMs:Number.isFinite(meta?.expectedDisplayTime)?Math.max(0,tp-meta.expectedDisplayTime):null,
        mediaTimeMs:Number.isFinite(meta?.mediaTime)?meta.mediaTime*1000:null,presentedFrames:meta?.presentedFrames??null};
      this.info.captured++;const context=this.opt.onFrame(fr);
      if(this.busy||this.info.backend==='loading-fallback'||this.info.backend==='unavailable'){this.info.skipped++;return;}
      if(this.worker){
        this.busy=true;this.pending={fr,context};
        this.watchdog=setTimeout(()=>this.fallback('inference-timeout'),this.info.inferred ? 2500 : 10000);
        createImageBitmap(this.video).then(bitmap=>{
          if(!this.worker||this.stopped||this.pending?.fr!==fr){bitmap.close();return;}
          this.worker.postMessage({type:'frame',t,bitmap},[bitmap]);
        }).catch(e=>this.fallback(String(e.message||e)));
      }else if(this.detector){
        // 주 스레드: 카메라 프레임마다 추론(최대 약 33Hz). 밝기가 충분하면 영상 요소를 그대로 넣어 복사 비용을 없앤다
        if(t-(this.lastInfer||0)<28){this.info.skipped++;return;}this.lastInfer=t;
        try{
          const g0=NLSignal.exposureGain(this.ctx);this.gainS=this.gainS==null?g0:this.gainS+.12*(g0-this.gainS);const gain=Math.round(this.gainS*20)/20;
          let result;
          if(gain>1.05){
            const c=this.inferCanvas,ctx=this.inferCtx,w=Math.min(640,this.video.videoWidth),h=Math.round(w*this.video.videoHeight/this.video.videoWidth);
            if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
            ctx.drawImage(this.video,0,0,w,h);NLSignal.enhance(ctx,gain);result=this.detector.detectForVideo(c,t);
          } else result=this.detector.detectForVideo(this.video,t);
          const lm=result.faceLandmarks?.[0];
          const eyes=lm?{left:NLSignal.eyeQuality(this.ctx,lm,[362,263,386,374]),right:NLSignal.eyeQuality(this.ctx,lm,[33,133,159,145])}:null;
          this.deliver({fr,context},{t,result,skin:NLSignal.sampleSkin(this.ctx,lm),eyes,gain});
          this.consecutiveErrors=0;
        }catch(e){
          this.info.errors++;fr.reason='inference-error';this.consecutiveErrors=(this.consecutiveErrors||0)+1;
          if(this.consecutiveErrors>=3){this.info.backend='unavailable';this.detector.close();this.detector=null;this.opt.onError?.(e);}
        }
      }
    }
    start(){
      const v=this.video;
      const capture=meta=>{try{this.capture(meta);}catch(e){this.info.errors++;this.opt.onError?.(e);}};
      if(v.requestVideoFrameCallback){const cb=(_,meta)=>{if(this.stopped)return;capture(meta);this.callback=v.requestVideoFrameCallback(cb);};this.callback=v.requestVideoFrameCallback(cb);}
      else{let last=-1;const cb=()=>{if(this.stopped)return;if(v.currentTime!==last){last=v.currentTime;capture();}this.callback=requestAnimationFrame(cb);};this.callback=requestAnimationFrame(cb);}
    }
    stop(){this.stopped=true;clearTimeout(this.watchdog);this.worker?.terminate();this.detector?.close();
      if(this.video.cancelVideoFrameCallback)this.video.cancelVideoFrameCallback(this.callback);else cancelAnimationFrame(this.callback);
    }
  }
  root.NLCamera=Camera;
})(window);
