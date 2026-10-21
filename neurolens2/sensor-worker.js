/* Pixels remain in this worker. Only numeric, timestamped observations are returned. */
let detector,canvas,ctx,geometry=null,lastInference=-Infinity,previous=null,pageOrigin=0,faceCount=0;
const median=a=>{const b=a.sort((x,y)=>x-y);return b.length?b[b.length>>1]:0;};
function roi(lm,id,rw,rh,name){
  const W=canvas.width,H=canvas.height,width=Math.hypot(lm[454].x-lm[234].x,lm[454].y-lm[234].y);
  const w=Math.round(width*W*rw),h=Math.round(width*W*rh),x=Math.round(lm[id].x*W-w/2),y=Math.round(lm[id].y*H-h/2);
  if(w<5||h<4||x<0||y<0||x+w>W||y+h>H)return null;
  const pixels=ctx.getImageData(x,y,w,h).data,items=[];
  for(let i=0;i<pixels.length;i+=8){const rgb=[pixels[i],pixels[i+1],pixels[i+2]],sum=rgb.reduce((a,b)=>a+b,0),l=sum/3;
    if(l>12&&l<240&&Math.max(...rgb)<252)items.push({rgb,l,r:rgb[0]/sum,g:rgb[1]/sum});}
  const mr=median(items.map(p=>p.r)),mg=median(items.map(p=>p.g)),ml=median(items.map(p=>p.l)),mad=median(items.map(p=>Math.abs(p.l-ml)));
  const use=items.filter(p=>Math.abs(p.r-mr)<.07&&Math.abs(p.g-mg)<.07&&Math.abs(p.l-ml)<Math.max(12,3*mad));
  if(!use.length)return null;
  return {id:name,rgb:[0,1,2].map(c=>use.reduce((s,p)=>s+p.rgb[c],0)/use.length),coverage:Math.min(1,use.length/Math.ceil(w*h/2)),box:[x/W,y/H,w/W,h/H]};
}
function observations(lm,t,fresh){
  if(!lm)return {face:false,detected:false,faceCount,fresh,rois:[]};
  const width=Math.abs(lm[454].x-lm[234].x),nose=lm[1],yaw=(nose.x-(lm[454].x+lm[234].x)/2)/Math.max(.01,width);
  const motion=previous?Math.hypot(nose.x-previous.x,nose.y-previous.y):0;if(fresh)previous={x:nose.x,y:nose.y};
  const eye=(a,b,c)=>{const dx=lm[b].x-lm[a].x,dy=lm[b].y-lm[a].y;return ((lm[c].x-lm[a].x)*dx+(lm[c].y-lm[a].y)*dy)/(dx*dx+dy*dy);};
  const opening=(a,b,c,d)=>Math.hypot(lm[c].x-lm[d].x,lm[c].y-lm[d].y)/Math.max(.001,Math.hypot(lm[a].x-lm[b].x,lm[a].y-lm[b].y));
  const blink=opening(33,133,159,145)<.12||opening(362,263,386,374)<.12;
  const eyePixels=Math.min(Math.abs(lm[33].x-lm[133].x),Math.abs(lm[362].x-lm[263].x))*canvas.width;
  const rois=[[151,.26,.10,'forehead'],[50,.14,.12,'left-cheek'],[280,.14,.12,'right-cheek']].map(a=>roi(lm,...a)).filter(Boolean);
  const bg=ctx.getImageData(0,0,12,12).data;let background=0;for(let i=0;i<bg.length;i+=4)background+=(bg[i]+bg[i+1]+bg[i+2])/3;
  return {detected:true,faceCount,centerX:(lm[454].x+lm[234].x)/2,centerY:(lm[10].y+lm[152].y)/2,roll:lm[263].y-lm[33].y,luminance:median(rois.map(r=>(r.rgb[0]+r.rgb[1]+r.rgb[2])/3)),face:faceCount===1&&width>.16&&Math.abs(yaw)<.3,fresh,eye:lm.length>=478&&eyePixels>=16&&!blink?(eye(33,133,468)+eye(362,263,473))/2:null,
    blink,yaw,motion,faceWidth:width,eyePixels,geometryAge:t-lastInference,rois,background:background/144};
}
self.onmessage=async({data:m})=>{
  if(m.type==='init'){
    pageOrigin=m.pageOrigin;
    try{const {FaceLandmarker,FilesetResolver}=await import('./vendor/vision_bundle.mjs');
      const files=await FilesetResolver.forVisionTasks(new URL('./vendor',self.location).href);
      detector=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./vendor/face_landmarker.task',self.location).href,delegate:'CPU'},runningMode:'VIDEO',numFaces:2});
      canvas=new OffscreenCanvas(640,480);ctx=canvas.getContext('2d',{willReadFrequently:true});self.postMessage({type:'ready'});
    }catch(e){self.postMessage({type:'error',message:'얼굴 모델을 불러오지 못했습니다.'});}return;
  }
  if(m.type==='frame'){
    try{
      if(!detector||performance.timeOrigin+performance.now()-pageOrigin-m.t>300)return;
      if(canvas.width!==m.bitmap.width||canvas.height!==m.bitmap.height){canvas.width=m.bitmap.width;canvas.height=m.bitmap.height;}
      ctx.drawImage(m.bitmap,0,0);
      const fresh=m.t-lastInference>=65;
      if(fresh){const faces=detector.detectForVideo(canvas,m.t).faceLandmarks||[];faceCount=faces.length;geometry=faces[0]||null;lastInference=m.t;}
      self.postMessage({type:'observation',frame:{t:m.t,mediaTime:m.mediaTime,...observations(geometry,m.t,fresh)}});
    }catch(e){self.postMessage({type:'error',message:'영상 처리 오류가 발생했습니다.'});}
    finally{m.bitmap.close();self.postMessage({type:'done'});}
  }
};
