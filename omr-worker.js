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
 function bands(y,slope){
  const out=[];let start=-1,last=-1;
  for(let x=0;x<w;x++){
   const yy=Math.round(y+slope*(x-w/2));
   if(yy<1||yy>=h-1)continue;
   const pixel=dark[yy*w+x]||dark[(yy-1)*w+x]||dark[(yy+1)*w+x];
   if(pixel){
    if(start===-1){start=x;last=x}
    else if(x-last<=1)last=x;
    else {if(last-start+1>=Math.max(7,w*.013))out.push({x:start,end:last,w:last-start+1});start=x;last=x}
   }
  }
  if(start!==-1&&last-start+1>=Math.max(7,w*.013))out.push({x:start,end:last,w:last-start+1});
  return out;
 }
 const candidates=[];
 for(let si=-16;si<=16;si++){
  const slope=si/100;
  for(let y=Math.floor(h*.09);y<Math.floor(h*.95);y++){
   const runs=bands(y,slope);
   if(runs.length!==10)continue;
   const widths=runs.map(r=>r.w).sort((a,b)=>a-b),median=widths[5];
   if(median<Math.max(7,w*.013)||median>w*.16||widths[0]<median*.68||widths[9]>median*1.4)continue;
   const gaps=runs.slice(1).map((r,i)=>r.x-runs[i].x),avg=gaps.reduce((a,b)=>a+b,0)/9;
   if(avg<median*.94||gaps.some(g=>Math.abs(g-avg)>avg*.28))continue;
   candidates.push({y,runs,slope,median,score:runs.reduce((a,b)=>a+b.w,0)});
  }
 }
 if(!candidates.length)return {error:"As dez colunas não foram localizadas na foto.",boxes:[],results:[]};
 candidates.sort((a,b)=>b.score-a.score);
 let top=null,lower=0;
 // Aceita o tamanho real do cartão na foto. A altura esperada é proporcional
 // à largura das caixas (aprox. 3,6 vezes), não à altura da tela.
 for(const c of candidates.slice(0,160)){
  const from=Math.max(c.y+Math.round(c.median*2.6),c.y+18);
  const to=Math.min(h-1,c.y+Math.round(c.median*5.1));
  let bestY=0,bestScore=0;
  for(let y=from;y<=to;y++){
   let lined=0,well=0;
   for(const r of c.runs){
    let hits=0,n=0;
    for(let x=r.x+2;x<=r.end-2;x++){
     const yy=Math.round(y+c.slope*(x-w/2));
     if(yy>=0&&yy<h){n++;hits+=dark[yy*w+x]}
    }
    const ratio=n?hits/n:0;
    lined+=ratio;if(ratio>.50)well++;
   }
   const score=lined/10;
   if(well>=7&&score>.53&&score>bestScore){bestScore=score;bestY=y}
  }
  if(bestY&&(!top||c.score>top.score)){top=c;lower=bestY}
 }
 if(!top)return {error:"As bordas do cartão não foram identificadas. Aproxime e enquadre as dez colunas.",boxes:[],results:[]};
 const height=lower-top.y;
 const boxes=top.runs.map(r=>{
  const y=top.y+top.slope*(r.x-w/2);
  return {x:r.x,y,w:r.w,h:height,quad:[
   {x:r.x,y},{x:r.end,y:y+top.slope*(r.end-r.x)},
   {x:r.end,y:y+top.slope*(r.end-r.x)+height},{x:r.x,y:y+height}
  ]};
 });
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
    const cx=b.x+b.w*fraction;
    const cy=b.y+top.slope*(cx-b.x)+b.h*(.149+.0855*d);
    const fill=density(cx,cy,Math.max(2,b.w*.055),Math.max(2,b.h*.016));
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