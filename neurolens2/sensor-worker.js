/* Pixels remain in this worker. Only numeric, timestamped observations are returned. */
importScripts('motion.js');
let detector,canvas,ctx,geometryCanvas,geometryContext,geometry=null,lastInference=-Infinity,previous=null,pageOrigin=0,faceCount=0,roiBoxes={},torso=null,epoch=0;
const median=a=>{const b=a.sort((x,y)=>x-y);return b.length?b[b.length>>1]:0;};
function roi(lm,id,rw,rh,name){
  const W=canvas.width,H=canvas.height,width=Math.hypot(lm[454].x-lm[234].x,lm[454].y-lm[234].y);
  const raw=[lm[id].x*W-width*W*rw/2,lm[id].y*H-width*W*rh/2,width*W*rw,width*W*rh];
  const last=roiBoxes[name];roiBoxes[name]=last&&Math.hypot(raw[0]-last[0],raw[1]-last[1])<10?raw.map((v,i)=>last[i]*.7+v*.3):raw;
  const [x,y,w,h]=roiBoxes[name].map(Math.round);
  if(w<5||h<4||x<0||y<0||x+w>W||y+h>H)return null;
  const pixels=ctx.getImageData(x,y,w,h).data,items=[];
  for(let i=0;i<pixels.length;i+=8){const rgb=[pixels[i],pixels[i+1],pixels[i+2]],sum=rgb.reduce((a,b)=>a+b,0),l=sum/3;
    if(l>12&&l<240&&Math.max(...rgb)<252)items.push({rgb,l,r:rgb[0]/sum,g:rgb[1]/sum});}
  const mr=median(items.map(p=>p.r)),mg=median(items.map(p=>p.g)),ml=median(items.map(p=>p.l)),mad=median(items.map(p=>Math.abs(p.l-ml)));
  const use=items.filter(p=>Math.abs(p.r-mr)<.07&&Math.abs(p.g-mg)<.07&&Math.abs(p.l-ml)<Math.max(12,3*mad));
  if(!use.length)return null;
  return {id:name,rgb:[0,1,2].map(c=>use.reduce((s,p)=>s+p.rgb[c],0)/use.length),pixels:use.length,coverage:Math.min(1,use.length/Math.ceil(w*h/2)),box:[x/W,y/H,w/W,h/H]};
}
function chest(lm,t){
  if(!lm){torso=null;return null;}
  const W=canvas.width,H=canvas.height,fw=Math.abs(lm[454].x-lm[234].x),cx=(lm[454].x+lm[234].x)/2,chin=lm[152].y;
  if(chin+.20>1){torso=null;return {valid:false,reason:'가슴 윗부분이 화면 밖입니다.'};}
  if(!torso||t-torso.t>250||Math.abs(cx-torso.cx)>.035||Math.abs(chin-torso.chin)>.035){
    torso={t,cx,chin,epoch:++epoch,previous:{},sums:{left:0,right:0,background:0},boxes:{left:[cx-fw*.95,chin+.025,fw*.8,.17],right:[cx+fw*.15,chin+.025,fw*.8,.17],background:[.015,.05,.12,.20]}};
  }
  const result={valid:true,epoch:torso.epoch,head:(chin-torso.chin)*H/ (H*.17/40)},size=40;
  for(const [name,b] of Object.entries(torso.boxes)){
    const [x,y,w,h]=b.map((v,i)=>Math.round(v*(i%2===0?W:H)));
    if(x<0||y<0||x+w>W||y+h>H){result.valid=false;continue;}
    const data=ctx.getImageData(x,y,w,h).data,gray=[];
    for(let row=0;row<size;row++)for(let col=0;col<size;col++){const at=(Math.min(h-1,Math.floor(row*h/size))*w+Math.min(w-1,Math.floor(col*w/size)))*4;gray.push((data[at]+data[at+1]+data[at+2])/3);}
    const flow=NL2Motion.flow(torso.previous[name],gray,size);torso.previous[name]=gray;
    if(flow?.valid)torso.sums[name]+=flow.dy;
    if(name!=='background'&&!flow?.valid)result.valid=false;
    if(name==='background')result.backgroundAvailable=!!flow?.valid;
    result[name]=torso.sums[name];
  }
  torso.t=t;return result;
}
function observations(lm,t,fresh){
  if(!lm)return {face:false,detected:false,faceCount,fresh,rois:[]};
  const width=Math.abs(lm[454].x-lm[234].x),nose=lm[1],yaw=(nose.x-(lm[454].x+lm[234].x)/2)/Math.max(.01,width);
  const motion=previous?Math.hypot(nose.x-previous.x,nose.y-previous.y):0;if(fresh)previous={x:nose.x,y:nose.y};
  const eye=(a,b,c)=>{const dx=lm[b].x-lm[a].x,dy=lm[b].y-lm[a].y;return ((lm[c].x-lm[a].x)*dx+(lm[c].y-lm[a].y)*dy)/(dx*dx+dy*dy);};
  const opening=(a,b,c,d)=>Math.hypot(lm[c].x-lm[d].x,lm[c].y-lm[d].y)/Math.max(.001,Math.hypot(lm[a].x-lm[b].x,lm[a].y-lm[b].y));
  const blink=opening(33,133,159,145)<.12||opening(362,263,386,374)<.12;
  const eyePixels=Math.min(Math.abs(lm[33].x-lm[133].x),Math.abs(lm[362].x-lm[263].x))*canvas.width;
  const rois=[[151,.46,.12,'forehead'],[50,.22,.20,'left-cheek'],[280,.22,.20,'right-cheek']].map(a=>roi(lm,...a)).filter(Boolean);
  const bg=ctx.getImageData(0,0,12,12).data;let background=0;for(let i=0;i<bg.length;i+=4)background+=(bg[i]+bg[i+1]+bg[i+2])/3;
  return {detected:true,faceCount,centerX:(lm[454].x+lm[234].x)/2,centerY:(lm[10].y+lm[152].y)/2,roll:lm[263].y-lm[33].y,luminance:median(rois.map(r=>(r.rgb[0]+r.rgb[1]+r.rgb[2])/3)),face:faceCount===1&&width>.16&&Math.abs(yaw)<.3,fresh,eye:lm.length>=478&&eyePixels>=16&&!blink?(eye(33,133,468)+eye(362,263,473))/2:null,
    blink,yaw,motion,faceWidth:width,eyePixels,geometryAge:t-lastInference,rois,background:background/144,resp:chest(lm,t)};
}
self.onmessage=async({data:m})=>{
  if(m.type==='init'){
    pageOrigin=m.pageOrigin;
    try{const {FaceLandmarker,FilesetResolver}=await import('./vendor/vision_bundle.mjs');
      const files=await FilesetResolver.forVisionTasks(new URL('./vendor',self.location).href);
      detector=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./vendor/face_landmarker.task',self.location).href,delegate:'CPU'},runningMode:'VIDEO',numFaces:2});
      canvas=new OffscreenCanvas(960,720);ctx=canvas.getContext('2d',{willReadFrequently:true});geometryCanvas=new OffscreenCanvas(640,480);geometryContext=geometryCanvas.getContext('2d');self.postMessage({type:'ready'});
    }catch(e){self.postMessage({type:'error',message:'얼굴 모델을 불러오지 못했습니다.'});}return;
  }
  if(m.type==='frame'){
    try{
      if(!detector||performance.timeOrigin+performance.now()-pageOrigin-m.t>300)return;
      if(canvas.width!==m.bitmap.width||canvas.height!==m.bitmap.height){canvas.width=m.bitmap.width;canvas.height=m.bitmap.height;}
      ctx.drawImage(m.bitmap,0,0);
      const fresh=m.t-lastInference>=65;
      if(fresh){const height=Math.round(640*canvas.height/canvas.width);if(geometryCanvas.height!==height)geometryCanvas.height=height;geometryContext.drawImage(canvas,0,0,640,height);const faces=detector.detectForVideo(geometryCanvas,m.t).faceLandmarks||[];faceCount=faces.length;geometry=faces[0]||null;lastInference=m.t;}
      self.postMessage({type:'observation',frame:{t:m.t,mediaTime:m.mediaTime,...observations(geometry,m.t,fresh)}});
    }catch(e){self.postMessage({type:'error',message:'영상 처리 오류가 발생했습니다.'});}
    finally{m.bitmap.close();self.postMessage({type:'done'});}
  }
};
