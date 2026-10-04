/* Optional BLE Heart Rate Service. Notification receipt is not the sensor's sample clock. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.NLReference=api;})(typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';
  function parse(view){
    if(view.byteLength<2)throw Error('short-heart-rate-packet');
    const flags=view.getUint8(0),wide=flags&1;if(wide&&view.byteLength<3)throw Error('short-heart-rate-packet');
    const bpm=wide?view.getUint16(1,true):view.getUint8(1),contactSupported=!!(flags&4),contact=!contactSupported?null:!!(flags&2);
    return {bpm,quality:bpm>=20&&bpm<=250&&contact!==false?1:0,contact};
  }
  class Collector {
    constructor(onStatus=()=>{}){this.onStatus=onStatus;this.samples=[];this.events=[];this.recording=false;}
    async connect(){
      if(!globalThis.navigator?.bluetooth)throw Error('이 브라우저에서는 Bluetooth 기준 장비 연결을 지원하지 않습니다. 기준 CSV를 사용할 수 있습니다.');
      this.disconnect();
      this.device=await navigator.bluetooth.requestDevice({filters:[{services:['heart_rate']}]});
      this.onDisconnect=()=>{this.events.push({t:performance.now(),type:'disconnected'});this.onStatus('기준 장비 연결 끊김');};
      this.device.addEventListener('gattserverdisconnected',this.onDisconnect);
      try{
        const server=await this.device.gatt.connect(),service=await server.getPrimaryService('heart_rate');
        this.characteristic=await service.getCharacteristic('heart_rate_measurement');
        this.listener=e=>{try{const p={...parse(e.target.value),t:performance.now()};if(p.bpm<20||p.bpm>250)throw Error('invalid-heart-rate');if(this.recording)this.samples.push(p);this.onStatus('기준 장비 '+p.bpm+' bpm');}catch(_){if(this.recording)this.events.push({t:performance.now(),type:'invalid-packet'});}};
        this.characteristic.addEventListener('characteristicvaluechanged',this.listener);await this.characteristic.startNotifications();this.onStatus('기준 장비 연결됨');
      }catch(e){this.disconnect();throw e;}
    }
    start(){this.samples=[];this.events=[];this.recording=true;}
    stop(){this.recording=false;return this.snapshot();}
    snapshot(){return {source:'ble-heart-rate',verified:false,sync:{offsetMs:0,driftPpm:0,uncertaintyMs:null,method:'notification-receipt'},samples:this.samples.slice(),events:this.events.slice()};}
    disconnect(){this.recording=false;if(this.characteristic&&this.listener)this.characteristic.removeEventListener('characteristicvaluechanged',this.listener);if(this.device&&this.onDisconnect)this.device.removeEventListener('gattserverdisconnected',this.onDisconnect);this.device?.gatt?.disconnect();this.device=null;this.characteristic=null;}
  }
  return {parse,Collector};
});
