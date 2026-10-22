export class Camera {
  constructor(video,onFrame,onFailure){this.video=video;this.onFrame=onFrame;this.onFailure=onFailure;this.stopped=true;}
  async start(){
    this.stopped=false;
    try{
      this.stream=await new Promise((resolve,reject)=>{
        let settled=false;
        this.cancelMedia=()=>{if(settled)return;settled=true;clearTimeout(this.mediaTimeout);reject(Error('카메라 연결이 취소됐거나 시간이 초과됐습니다. 다시 연결하거나 카메라 없이 계속할 수 있습니다.'));};
        this.mediaTimeout=setTimeout(this.cancelMedia,25000);
        navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:30}},audio:false}).then(stream=>{
          if(settled||this.stopped){stream.getTracks().forEach(t=>t.stop());return;}
          settled=true;clearTimeout(this.mediaTimeout);this.cancelMedia=null;resolve(stream);
        },error=>{if(settled)return;settled=true;clearTimeout(this.mediaTimeout);this.cancelMedia=null;reject(error);});
      });
      if(this.stopped){this.stream.getTracks().forEach(t=>t.stop());throw Error('카메라 시작이 취소되었습니다.');}
      const track=this.stream.getVideoTracks()[0],settings=track.getSettings();
      track.onended=()=>{if(!this.stopped)this.onFailure('카메라 연결이 종료되었습니다.');};
      this.video.srcObject=this.stream;await this.video.play();
      this.worker=new Worker(new URL('./sensor-worker.js',import.meta.url));
      await new Promise((resolve,reject)=>{
        this.rejectReady=reject;
        this.readyTimeout=setTimeout(()=>reject(Error('얼굴 모델 준비 시간이 초과되었습니다.')),30000);
        this.worker.onerror=()=>reject(Error('영상 처리 작업자를 시작하지 못했습니다.'));
        this.worker.onmessage=({data:m})=>{if(m.type==='ready'){clearTimeout(this.readyTimeout);this.rejectReady=null;resolve();}
          if(m.type==='error'){if(this.rejectReady)reject(Error(m.message));else this.onFailure(m.message);}
          if(m.type==='observation')this.onFrame(m.frame);
          if(m.type==='done')this.busy=false;};
        this.worker.postMessage({type:'init',pageOrigin:performance.timeOrigin});
      });
      if(this.stopped)throw Error('카메라 시작이 취소되었습니다.');
      this.worker.onerror=()=>this.onFailure('영상 처리 작업자가 중단되었습니다.');
      const loop=async(t,meta)=>{
        if(this.stopped)return;
        if(!this.busy&&this.video.readyState>=2&&(meta?.mediaTime!==this.lastMediaTime||!meta)){
          this.busy=true;this.lastMediaTime=meta?.mediaTime;
          try{const bitmap=await createImageBitmap(this.video);if(this.stopped){bitmap.close();return;}this.worker.postMessage({type:'frame',bitmap,t,mediaTime:meta?.mediaTime??this.video.currentTime},[bitmap]);}
          catch{this.busy=false;if(!this.stopped)this.onFailure('영상 프레임을 읽지 못했습니다.');}
        }
        this.handle=this.video.requestVideoFrameCallback?this.video.requestVideoFrameCallback(loop):requestAnimationFrame(loop);
      };
      this.handle=this.video.requestVideoFrameCallback?this.video.requestVideoFrameCallback(loop):requestAnimationFrame(loop);
      return {width:settings.width,height:settings.height,fps:settings.frameRate,facingMode:settings.facingMode||'user',trackId:settings.deviceId||''};
    }catch(e){this.stop();throw e;}
  }
  stop(){this.stopped=true;this.cancelMedia?.();this.cancelMedia=null;clearTimeout(this.mediaTimeout);clearTimeout(this.readyTimeout);if(this.rejectReady){this.rejectReady(Error('카메라 준비 취소'));this.rejectReady=null;}
    if(this.handle!==undefined){if(this.video.cancelVideoFrameCallback)this.video.cancelVideoFrameCallback(this.handle);else cancelAnimationFrame(this.handle);}
    this.worker?.terminate();this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});if(this.video.srcObject===this.stream)this.video.srcObject=null;this.busy=false;}
}
