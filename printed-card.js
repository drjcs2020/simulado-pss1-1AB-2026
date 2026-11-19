"use strict";
// Grade real do PSS1: 10 questões x 4 proposições 01/02/04/08.

// Detector do cartão de respostas realmente impresso nas provas PSS1:
// 10 linhas (Q01–Q10), 4 círculos por linha (01,02,04,08).
// O campo "Soma (00–15)" é resultado, NÃO deve ser lido como dezenas/unidades.
const BITS=[1,2,4,8];
const EDGES=[0,.146,.303,.46,.618,.775,1];
const CIRCLES=[.224,.382,.539,.696];

function decodePrintedCard(dark,w,h){
 if(w<200||h<180||dark.length!==w*h)throw Error('Imagem binária inválida.');
 const midX=w/2;
 const minLength=Math.max(75,Math.floor(w*.24));
 const lines=[];
 // Detecta as 3 bordas horizontais da grade; admite uma pequena inclinação.
 for(let si=-8;si<=8;si++){
  const slope=si*.02;
  for(let y=6;y<h-5;y++){
   let start=-1,last=-1,hits=0;
   const collect=()=>{
    if(start<0)return;
    const span=last-start+1;
    if(span>=minLength&&hits/span>=.68)
     lines.push({y,slope,x0:start,x1:last,len:span,score:hits});
   };
   for(let x=0;x<w;x++){
    const yy=Math.round(y+slope*(x-midX));
    let marked=false;
    if(yy>0&&yy<h-1){
     const idx=yy*w+x;
     marked=dark[idx]>0||dark[idx-w]>0||dark[idx+w]>0;
    }
    if(marked){if(start<0)start=x;last=x;hits++;}
    else if(start>=0&&x-last>13){collect();start=-1;last=-1;hits=0;}
   }
   collect();
  }
 }
 lines.sort((a,b)=>b.score-a.score);
 const unique=[];
 for(const line of lines){
  if(unique.some(other=>Math.abs(other.y-line.y)<=2&&Math.abs(other.slope-line.slope)<=.06))continue;
  unique.push(line);if(unique.length>=40)break;
 }
 let best=null;
 const vertical=(top,bottom,fraction)=>{
  const widest=top.len>=bottom.len?top:bottom;
  const width=widest.len,left=widest.x0;
  let strongest=0,bestX=left+width*fraction;
  const tolerance=Math.max(3,Math.round(width*.025));
  for(let dx=-tolerance;dx<=tolerance;dx+=2){
   let hits=0,total=0;
   for(let y=top.y+4;y<bottom.y-3;y+=2){
    const x=Math.round(left+width*fraction+dx-top.slope*(y-(top.y+bottom.y)/2));
    if(x<2||x>=w-2)continue;
    for(let offset=-2;offset<=2;offset++)
     if(dark[y*w+x+offset]){hits++;break;}
    total++;
   }
   const fractionMarked=total?hits/total:0;
   if(fractionMarked>strongest){strongest=fractionMarked;bestX=left+width*fraction+dx;}
  }
  return {ratio:strongest,x:bestX};
 };
 for(const top of unique)for(const bottom of unique){
  const height=bottom.y-top.y;
  if(height<Math.max(32,h*.055)||height>h*.96)continue;
  if(Math.abs(top.len-bottom.len)>Math.max(50,top.len*.45))continue;
  if(Math.abs(top.x0-bottom.x0)>Math.max(100,top.len*.45))continue;
  if(Math.abs(top.x1-bottom.x1)>Math.max(100,top.len*.45))continue;
  if(Math.abs(top.slope-bottom.slope)>.08)continue;
  // Segunda linha horizontal = divisória do cabeçalho, a 1/11 da altura.
  const headerY=top.y+height/11;
  let headerHits=0,headerSamples=0;
  for(let x=top.x0+4;x<top.x1-4;x+=3){
   const y=Math.round(headerY+top.slope*(x-midX));
   if(y<1||y>=h-1)continue;
   headerSamples++;
   if(dark[y*w+x]||dark[(y-1)*w+x]||dark[(y+1)*w+x])headerHits++;
  }
  const header=headerSamples?headerHits/headerSamples:0;
  if(header<.52)continue;
  const columns=EDGES.map(f=>vertical(top,bottom,f));
  const aligned=columns.filter(c=>c.ratio>.65).length;
  const avg=columns.reduce((sum,c)=>sum+c.ratio,0)/7;
  if(aligned<5||avg<.66)continue;
  const score=header*3+avg*7+top.len/w;
  if(!best||score>best.score)best={t:top,b:bottom,col:columns,score};
 }
 if(!best)return {error:'Grade do cartão PSS1 não identificada. Enquadre as 10 questões e as 4 proposições.',boxes:[],results:[]};
 const {t,b,col}=best;
 const left=col[0].x,right=col[6].x;
 const width=right-left,rowHeight=(b.y-t.y)/11;
 if(width<60||rowHeight<4)return {error:'Grade muito pequena para reconhecer as marcações.',boxes:[],results:[]};
 const density=(cx,cy)=>{
  const rx=Math.max(2.5,width*.0088),ry=Math.max(2.2,rowHeight*.17);
  let filled=0,total=0;
  for(let y=Math.max(0,Math.floor(cy-ry));y<=Math.min(h-1,Math.ceil(cy+ry));y++)
   for(let x=Math.max(0,Math.floor(cx-rx));x<=Math.min(w-1,Math.ceil(cx+rx));x++){
    const dx=(x-cx)/rx,dy=(y-cy)/ry;
    if(dx*dx+dy*dy>.95)continue;
    total++;if(dark[y*w+x])filled++;
   }
  return total?filled/total:0;
 };
 const centers=CIRCLES.map(f=>left+width*f);
 const boxes=[];
 const results=[];
 for(let q=0;q<10;q++){
  const centerY=t.y+(q+1.5)*rowHeight;
  const columns=centers.map((x,k)=>{
   const y=centerY+t.slope*(x-midX),fill=density(x,y);
   const marked=fill>=.70;
   return {digit:marked?BITS[k]:null,candidate:BITS[k],confidence:fill,x,y};
  });
  let sum=0;
  for(const c of columns)if(c.digit!==null)sum+=c.digit;
  // Não inventa resposta se um círculo estiver limítrofe/ilegível.
  const uncertain=columns.some(c=>c.confidence>.68&&c.confidence<.70);
  const y=t.y+(q+1)*rowHeight;
  boxes.push({x:left,y,w:width,h:rowHeight,quad:[
   {x:left,y},{x:right,y},{x:right,y:y+rowHeight},{x:left,y:y+rowHeight}
  ]});
  results.push({columns,value:uncertain?null:sum,valid:!uncertain});
 }
 return {boxes,results};
}

self.decodePrintedCard=decodePrintedCard;
