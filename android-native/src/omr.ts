// Detector para o cartão atual: dez caixas altas, cada uma com dezena (0/1) e unidade (0 a 9).
// As quatro extremidades da grade funcionam como âncoras geométricas.
// Os cantos e as posições das marcas estão em coordenadas do quadro reduzido.
export type Point={x:number;y:number};
export type CardBox={x:number;y:number;w:number;h:number;quad:Point[]};
export type OMRDigit={digit:number|null;candidate:number;confidence:number;x?:number;y?:number};
export type OMRQuestion={columns:OMRDigit[];value:number|null;valid:boolean};
export type Detection={error?:string;boxes:CardBox[];results:OMRQuestion[]};
export type Confirmed={values:number[];boxes:CardBox[];corners:[Point,Point,Point,Point];width:number;height:number};
export function cornersFromBoxes(boxes:CardBox[]):[Point,Point,Point,Point] {
 'worklet';
 if(boxes.length!==10)throw Error('Esperadas 10 colunas.');
 return [boxes[0].quad[0],boxes[9].quad[1],boxes[9].quad[2],boxes[0].quad[3]];
}
export function stableReading(previous:{signature:string;count:number},detected:Detection|null) {
 'worklet';
 if(!detected||detected.error||detected.results.length!==10||detected.results.some(r=>!r.valid))
  return {signature:'',count:0,stable:false,values:null as number[]|null};
 const values=detected.results.map(r=>r.value as number);
 const signature=values.join(',');
 const count=signature===previous.signature?previous.count+1:1;
 return {signature,count,stable:count>=3,values};
}
// Alternativa CPU quando o resizer Vulkan não inicia no Android.
// No formato YUV, o primeiro plano fornece a luminância (Y).
// A amostragem respeita bytesPerRow: muitas câmeras adicionam padding por linha.
export function luminanceToBinary(
 source:Uint8Array,width:number,height:number,bytesPerRow:number,
 outWidth=640,outHeight=480
):Uint8Array {
 'worklet';
 if(width<1||height<1||bytesPerRow<width||
    source.length<(height-1)*bytesPerRow+width)throw Error('Plano de luminância inválido.');
 const gray=new Uint8Array(outWidth*outHeight);
 const histogram=new Uint32Array(256);
 for(let y=0;y<outHeight;y++){
  const sy=Math.min(height-1,Math.floor((y+.5)*height/outHeight));
  for(let x=0;x<outWidth;x++){
   const sx=Math.min(width-1,Math.floor((x+.5)*width/outWidth));
   const value=source[sy*bytesPerRow+sx];
   gray[y*outWidth+x]=value;histogram[value]++;
  }
 }
 // Limiar de Otsu: adapta o contraste para luz natural ou fluorescente.
 const count=gray.length;let sum=0;
 for(let i=0;i<256;i++)sum+=i*histogram[i];
 let best=-1,threshold=128;
 let leftCount=0,leftSum=0;
 for(let i=0;i<256;i++){
  leftCount+=histogram[i];leftSum+=i*histogram[i];
  if(!leftCount||leftCount===count)continue;
  const meanLeft=leftSum/leftCount;
  const meanRight=(sum-leftSum)/(count-leftCount);
  const between=leftCount*(count-leftCount)*(meanLeft-meanRight)*(meanLeft-meanRight);
  if(between>best){best=between;threshold=i}
 }
 for(let i=0;i<gray.length;i++)gray[i]=gray[i]<=threshold?255:0;
 return gray;
}
export function decodeBinary(dark:Uint8Array,w:number,h:number):Detection {
 'worklet';
 if(w<=0||h<=0||dark.length!==w*h) throw Error('Imagem binária inválida.');
 function bands(y:number,slope:number):Array<{x:number,end:number,w:number}>{
  const out:Array<{x:number,end:number,w:number}>=[];let start=-1,last=-1;
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
 const candidates:Array<{y:number,runs:Array<{x:number,end:number,w:number}>,slope:number,median:number,score:number}>=[];
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
 let top:(typeof candidates)[number]|null=null,lower=0;
 // Aceita enquadramento só da grade e orientação vertical de telefone.
 // A câmera pode esticar a grade ao converter YUV para 640x480;
 // a razão altura/largura da caixa varia bastante (1,9x a 9x).
 for(const c of candidates.slice(0,160)){
  const from=Math.max(c.y+Math.round(c.median*1.9),c.y+18);
  const to=Math.min(h-1,c.y+Math.round(c.median*9.0));
  let bestY=0,bestScore=0;
  for(let y=from;y<=to;y++){
   let lined=0,well=0;
   for(const r of c.runs){
    let hits=0,n=0;
    for(let x=r.x+2;x<=r.end-2;x++){
     const yy=Math.round(y+c.slope*(x-w/2));
     if(yy>=0&&yy<h){n++;hits+=dark[yy*w+x]>0?1:0}
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
 const chosen=top;
 const height=lower-chosen.y;
 const boxes=chosen.runs.map(r=>{
  const y=chosen.y+chosen.slope*(r.x-w/2);
  return {x:r.x,y,w:r.w,h:height,quad:[
   {x:r.x,y},{x:r.end,y:y+chosen.slope*(r.end-r.x)},
   {x:r.end,y:y+top.slope*(r.end-r.x)+height},{x:r.x,y:y+height}
  ]};
 });
 function density(cx:number,cy:number,rx:number,ry:number){
  let total=0,num=0;
  for(let yy=Math.max(0,Math.round(cy-ry));yy<=Math.min(h-1,Math.round(cy+ry));yy++)
   for(let xx=Math.max(0,Math.round(cx-rx));xx<=Math.min(w-1,Math.round(cx+rx));xx++){
    total+=dark[yy*w+xx]>0?1:0;num++;
   }
  return num?total/num:0;
 }
 const results=boxes.map(b=>{
  const columns=[];
  for(const [fraction,count] of [[.329,2],[.673,10]]){
   const scores=[];
   for(let d=0;d<count;d++){
    const cx=b.x+b.w*fraction;
    const cy=b.y+chosen.slope*(cx-b.x)+b.h*(.149+.0855*d);
    const fill=density(cx,cy,Math.max(2,b.w*.055),Math.max(2,b.h*.016));
    scores.push({digit:d,value:fill});
   }
   scores.sort((a,b)=>b.value-a.value);
   const confident=scores[0].value>.55&&(scores[0].value-scores[1].value)>.24;
   columns.push({digit:confident?scores[0].digit:null,candidate:scores[0].digit,confidence:scores[0].value-scores[1].value});
  }
  const value=columns.every(c=>c.digit!==null)?columns[0].digit!*10+columns[1].digit!:null;
  return {columns,value,valid:value!==null&&value<=15};
 });
 return {boxes,results};
}