"use strict";
// Leitor leve: imagem RGBA => linhas do cartão => dezena/unidade.
// Não depende de OpenCV, rede, CDN ou processamento na interface.
function decode(data){
 const w=data.width,h=data.height,rgba=new Uint8Array(data.pixels);
 if(!w||!h||rgba.length!==w*h*4)throw Error("Imagem inválida.");
 const dark=new Uint8Array(w*h);
 for(let i=0,j=0;i<rgba.length;i+=4,j++){
  dark[j]=rgba[i]*.299+rgba[i+1]*.587+rgba[i+2]*.114<140?1:0;
 }
 function bands(y){
  const out=[],offset=y*w;
  let start=-1,last=-1;
  for(let x=0;x<w;x++){
   if(dark[offset+x]){
    if(start===-1){start=x;last=x}
    else if(x-last<=3)last=x;
    else {if(last-start+1>=w*.035)out.push({x:start,end:last,w:last-start+1});start=x;last=x}
   }
  }
  if(start!==-1&&last-start+1>=w*.035)out.push({x:start,end:last,w:last-start+1});
  return out;
 }
 // Procurar a linha horizontal superior das dez caixas; ignora título e QR.
 const candidates=[];
 for(let y=Math.floor(h*.25);y<Math.floor(h*.87);y++){
  const runs=bands(y);
  if(runs.length!==10)continue;
  const widths=runs.map(r=>r.w).sort((a,b)=>a-b);
  const median=widths[5];
  if(median<w*.035||median>w*.15||widths[0]<median*.67||widths[9]>median*1.38)continue;
  const gaps=runs.slice(1).map((r,i)=>r.x-runs[i].x),avg=gaps.reduce((a,b)=>a+b,0)/9;
  if(avg<=median||gaps.some(g=>Math.abs(g-avg)>avg*.26))continue;
  candidates.push({y,runs,avg,score:runs.reduce((a,b)=>a+b.w,0)});
 }
 if(!candidates.length)return {error:"Não encontrei as dez colunas do cartão. Confira o enquadramento.",boxes:[],results:[]};
 const top=candidates.sort((a,b)=>b.score-a.score)[0];
 // Detectar borda inferior percorrendo o lado esquerdo das dez caixas.
 let lower=0,maxHits=0;
 for(let y=top.y+Math.floor(h*.18);y<Math.min(h,top.y+Math.floor(h*.72));y++){
  let hits=0;
  for(const r of top.runs){
   // O limite externo das caixas é preto até a borda inferior.
   for(let dx=-1;dx<=1;dx++){
    const x=r.x+dx;if(x>=0&&x<w&&dark[y*w+x]){hits++;break}
   }
  }
  if(hits>=7){
   // O candidato inferior forma uma linha longa, não só os lados.
   let count=0;const offset=y*w;
   for(let x=top.runs[0].x;x<=top.runs[9].end;x++)count+=dark[offset+x];
   if(count>w*.43){lower=y;maxHits=hits}
  }
 }
 if(!lower||lower-top.y<h*.14)return {error:"Não localizei a parte inferior do cartão.",boxes:[],results:[]};
 const height=lower-top.y;
 const boxes=top.runs.map(r=>({x:r.x,y:top.y,w:r.w,h:height}));
 function density(cx,cy,rx,ry){
  let total=0,num=0;
  for(let yy=Math.max(0,Math.round(cy-ry));yy<=Math.min(h-1,Math.round(cy+ry));yy++)
   for(let xx=Math.max(0,Math.round(cx-rx));xx<=Math.min(w-1,Math.round(cx+rx));xx++){
    total+=dark[yy*w+xx];num++;
   }
  return num?total/num:0;
 }
 const results=boxes.map(b=>{
  const columns=[];
  for(const [fraction,count] of [[.329,2],[.673,10]]){
   const scores=[];
   for(let d=0;d<count;d++){
    const fill=density(b.x+b.w*fraction,b.y+b.h*(.149+.0855*d),Math.max(2,b.w*.055),Math.max(2,b.h*.016));
    scores.push({digit:d,value:fill});
   }
   scores.sort((a,b)=>b.value-a.value);
   const confident=scores[0].value>.55&&(scores[0].value-scores[1].value)>.24;
   columns.push({digit:confident?scores[0].digit:null,candidate:scores[0].digit,confidence:scores[0].value-scores[1].value});
  }
  const value=columns.every(c=>c.digit!==null)?columns[0].digit*10+columns[1].digit:null;
  return {columns,value,valid:value!==null&&value<=15};
 });
 return {boxes,results};
}
self.onmessage=function(event){
 const input=event.data||{};
 if(input.action!=="analyze")return;
 try{self.postMessage({id:input.id,status:"ok",result:decode(input)})}
 catch(err){self.postMessage({id:input.id,status:"error",message:String(err.message||err)})}
};