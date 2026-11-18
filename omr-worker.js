"use strict";
// Análise óptica executada fora da interface para nunca travar a câmera.
let cvReady=null;
function loadCv(){
 if(cvReady)return cvReady;
 cvReady=(async()=>{
  importScripts("https://docs.opencv.org/4.13.0/opencv.js");
  const module=await self.cv;
  if(!module||typeof module.matFromArray!=="function")throw Error("Reconhecimento óptico indisponível.");
  return module;
 })();
 return cvReady;
}
function quadSorted(points){
 const center={x:points.reduce((a,p)=>a+p.x,0)/4,y:points.reduce((a,p)=>a+p.y,0)/4};
 const sorted=points.slice().sort((a,b)=>Math.atan2(a.y-center.y,a.x-center.x)-Math.atan2(b.y-center.y,b.x-center.x));
 let first=0;for(let i=1;i<4;i++)if(sorted[i].x+sorted[i].y<sorted[first].x+sorted[first].y)first=i;
 return Array.from({length:4},(_,i)=>sorted[(first+i)%4]);
}
function readImage(lib,source){
 const src=lib.matFromArray(source.height,source.width,lib.CV_8UC4,new Uint8Array(source.pixels)),gray=new lib.Mat(),bw=new lib.Mat(),contours=new lib.MatVector(),hierarchy=new lib.Mat();
 try{
  lib.cvtColor(src,gray,lib.COLOR_RGBA2GRAY);
  lib.threshold(gray,bw,0,255,lib.THRESH_BINARY_INV|lib.THRESH_OTSU);
  lib.findContours(bw,contours,hierarchy,lib.RETR_LIST,lib.CHAIN_APPROX_SIMPLE);
  const w=bw.cols,h=bw.rows,candidates=[];
  for(let i=0;i<contours.size();i++){
   const contour=contours.get(i);
   try{
    const b=lib.boundingRect(contour),ratio=b.height/b.width;
    if(b.width>.023*w&&b.width<.16*w&&b.height>.11*h&&b.height<.77*h&&ratio>1.8&&b.y>.07*h){
     const rotated=lib.minAreaRect(contour);
     const q=quadSorted(lib.RotatedRect.points(rotated));
     candidates.push({x:b.x,y:b.y,w:b.width,h:b.height,area:b.width*b.height,quad:q});
    }
   }finally{contour.delete()}
  }
  const distinct=[];
  for(const b of candidates.sort((a,b)=>b.area-a.area)){
   const cx=b.x+b.w/2,cy=b.y+b.h/2;
   if(distinct.some(z=>Math.abs(z.x+z.w/2-cx)<Math.min(z.w,b.w)*.30&&Math.abs(z.y+z.h/2-cy)<Math.min(z.h,b.h)*.30))continue;
   distinct.push(b);
  }
  let boxes=[];
  for(const anchor of distinct){
   const set=distinct.filter(b=>{
    const dx=(b.x+b.w/2)-(anchor.x+anchor.w/2);
    const dy=(b.y+b.h/2)-(anchor.y+anchor.h/2);
    return Math.abs(b.h-anchor.h)<anchor.h*.27&&
           Math.abs(b.w-anchor.w)<anchor.w*.35&&
           Math.abs(dy)<Math.abs(dx)*.29+anchor.h*.09;
   }).sort((a,b)=>a.x-b.x);
   for(let off=0;off<=set.length-10;off++){
    const seq=set.slice(off,off+10),xs=seq.map(b=>b.x+b.w/2),ys=seq.map(b=>b.y+b.h/2);
    const gaps=xs.slice(1).map((x,i)=>x-xs[i]),avg=gaps.reduce((a,b)=>a+b,0)/9;
    if(avg<=0||gaps.some(v=>Math.abs(v-avg)>avg*.30))continue;
    const slope=(ys[9]-ys[0])/(xs[9]-xs[0]);
    if(Math.abs(slope)>.28||ys.some((y,i)=>Math.abs(y-(ys[0]+slope*(xs[i]-xs[0])))>seq[0].h*.13))continue;
    if(!boxes.length||seq.reduce((a,b)=>a+b.area,0)>boxes.reduce((a,b)=>a+b.area,0))boxes=seq;
   }
  }
  if(boxes.length!==10)return {error:'As dez colunas não foram reconhecidas com segurança.',boxes:[],results:[]};
  boxes.sort((a,b)=>a.x-b.x);
  const dst=lib.matFromArray(4,1,lib.CV_32FC2,[0,0,103,0,103,370,0,370]);
  const results=[];
  try{
   for(const box of boxes){
    const coords=box.quad.flatMap(p=>[p.x,p.y]);
    const sourcePoints=lib.matFromArray(4,1,lib.CV_32FC2,coords);
    const warped=new lib.Mat();let transform=null;
    try{
     transform=lib.getPerspectiveTransform(sourcePoints,dst);
     lib.warpPerspective(bw,warped,transform,new lib.Size(104,371),lib.INTER_LINEAR,lib.BORDER_CONSTANT,new lib.Scalar(0));
     const data=warped.data,rw=warped.cols,rh=warped.rows;
     function density(cx,cy,rx,ry){
      let sum=0,n=0;
      for(let y=Math.max(0,Math.round(cy-ry));y<=Math.min(rh-1,Math.round(cy+ry));y++)
       for(let x=Math.max(0,Math.round(cx-rx));x<=Math.min(rw-1,Math.round(cx+rx));x++){
        sum+=data[y*rw+x]>128?1:0;n++;
       }
      return n?sum/n:0;
     }
     const columns=[];
     for(const [frac,maxDigit] of [[.329,2],[.673,10]]){
      const scores=[];
      for(let d=0;d<maxDigit;d++){
       scores.push({digit:d,value:density(103*frac,370*(.149+.0855*d),5.5,6)});
      }
      scores.sort((a,b)=>b.value-a.value);
      const confident=scores[0].value>.58&&(scores[0].value-scores[1].value)>.25;
      columns.push({digit:confident?scores[0].digit:null,candidate:scores[0].digit,confidence:scores[0].value-scores[1].value});
     }
     const value=columns.every(z=>z.digit!==null)?columns[0].digit*10+columns[1].digit:null;
     results.push({columns,value,valid:value!==null&&value>=0&&value<=15});
    }finally{sourcePoints.delete();warped.delete();if(transform)transform.delete()}
   }
  }finally{dst.delete()}
  return {boxes,results};
 }finally{src.delete();gray.delete();bw.delete();contours.delete();hierarchy.delete()}
}

self.onmessage=async function(event){
 const data=event.data||{};
 if(data.action!=="analyze")return;
 try{
  const lib=await loadCv();
  const result=readImage(lib,data);
  self.postMessage({id:data.id,status:"ok",result});
 }catch(err){
  self.postMessage({id:data.id,status:"error",message:String(err&&err.message||err)});
 }
};
