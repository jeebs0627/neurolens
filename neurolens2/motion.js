/* Image-gradient flow on fixed torso patches, compensated for common brightness.
 * Numeric displacements only leave the sensor worker. No images are stored. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NL2Motion=api;})(typeof self!=='undefined'?self:globalThis,function(){
  function flow(previous,current,width){
    if(!previous||previous.length!==current.length)return null;
    const mean=a=>a.reduce((s,v)=>s+v,0)/a.length,da=mean(current)-mean(previous);let yy=0,yt=0,error=0,count=0;
    for(let i=width;i<current.length-width;i++){const g=(previous[i+width]-previous[i-width])/2,d=current[i]-previous[i]-da;yy+=g*g;yt+=g*d;count++;}
    const dy=-yt/(yy||1);
    for(let i=width;i<current.length-width;i++){const g=(previous[i+width]-previous[i-width])/2;error+=(current[i]-previous[i]-da+dy*g)**2;}
    return {dy,texture:yy/count,residual:Math.sqrt(error/count),valid:yy/count>2&&Math.abs(dy)<1.5&&Math.sqrt(error/count)<12};
  }
  return {flow};
});
