"use strict";
importScripts('printed-card.js?v=20261119b');
// Grade real impressa: quatro círculos 01/02/04/08 por questão.
function binaryFromRGBA(input){
 const w=input.width,h=input.height,rgba=new Uint8Array(input.pixels);
 if(w<100||h<100||rgba.length!==w*h*4)throw Error('Imagem incompleta.');
 const gray=new Uint8Array(w*h),hist=new Uint32Array(256);let sum=0;
 for(let i=0,j=0;i<rgba.length;i+=4,j++){
  const value=Math.round(rgba[i]*.299+rgba[i+1]*.587+rgba[i+2]*.114);
  gray[j]=value;hist[value]++;sum+=value;
 }
 let best=-1,threshold=127,leftCount=0,leftSum=0;
 for(let t=0;t<256;t++){
  leftCount+=hist[t];leftSum+=t*hist[t];
  if(!leftCount||leftCount===gray.length)continue;
  const a=leftSum/leftCount,b=(sum-leftSum)/(gray.length-leftCount);
  const variation=leftCount*(gray.length-leftCount)*(a-b)*(a-b);
  if(variation>best){best=variation;threshold=t}
 }
 for(let i=0;i<gray.length;i++)gray[i]=gray[i]<=threshold?255:0;
 return gray;
}
function rotated(bin,w,h,degrees){
 if(degrees===0)return {bin,w,h};
 const swap=degrees===90||degrees===270;
 const rw=swap?h:w,rh=swap?w:h,out=new Uint8Array(rw*rh);
 for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){
  let sx=x,sy=y;
  if(degrees===90){sx=y;sy=h-1-x}
  if(degrees===180){sx=w-1-x;sy=h-1-y}
  if(degrees===270){sx=w-1-y;sy=x}
  out[y*rw+x]=bin[sy*w+sx];
 }
 return {bin:out,w:rw,h:rh};
}
function backPoint(pt,w,h,degrees){
 if(degrees===90)return {x:pt.y,y:h-1-pt.x};
 if(degrees===180)return {x:w-1-pt.x,y:h-1-pt.y};
 if(degrees===270)return {x:w-1-pt.y,y:pt.x};
 return pt;
}
function backResult(result,w,h,degrees){
 if(!degrees||result.boxes.length!==10)return result;
 for(const box of result.boxes){
  box.quad=box.quad.map(p=>backPoint(p,w,h,degrees));
  const xs=box.quad.map(p=>p.x),ys=box.quad.map(p=>p.y);
  box.x=Math.min(...xs);box.y=Math.min(...ys);
  box.w=Math.max(...xs)-box.x;box.h=Math.max(...ys)-box.y;
 }
 for(const answer of result.results)
  for(const col of answer.columns){
   if(col.x!==undefined&&col.y!==undefined){
    const xy=backPoint({x:col.x,y:col.y},w,h,degrees);col.x=xy.x;col.y=xy.y;
   }
  }
 return result;
}
function decode(input){
 const w=input.width,h=input.height,bin=binaryFromRGBA(input);
 let best=null,bestCount=-1;
 for(const angle of [0,180,90,270]){
  const image=rotated(bin,w,h,angle);
  const result=decodePrintedCard(image.bin,image.w,image.h);
  const count=result.results.filter(r=>r.valid).length;
  if(count>bestCount){best=backResult(result,w,h,angle);bestCount=count}
  if(count===10)break;
 }
 return best||{error:'Grade não encontrada.',boxes:[],results:[]};
}
self.onmessage=function(event){
 const input=event.data||{};
 if(input.action!=='analyze')return;
 try{self.postMessage({id:input.id,status:'ok',result:decode(input)})}
 catch(err){self.postMessage({id:input.id,status:'error',message:String(err.message||err)})}
};