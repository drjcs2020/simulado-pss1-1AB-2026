"use strict";
// Reconhecimento AO VIVO do cartão decimal realmente impresso (10 colunas).
// Identifica os quatro marcadores de canto e usa suas posições para alinhar o quadro.
// Cada coluna tem uma casa da dezena (0/1) e outra de unidade (0..9).
const MARKER_ROIS=[
 {name:'tl',x0:0,x1:.32,y0:0,y1:.33},
 {name:'tr',x0:.68,x1:1,y0:0,y1:.33},
 {name:'bl',x0:0,x1:.32,y0:.67,y1:1},
 {name:'br',x0:.68,x1:1,y0:.67,y1:1}
];
function binaryFromRGBA(input){
 const w=input.width,h=input.height,rgba=new Uint8Array(input.pixels);
 if(w<240||h<180||rgba.length!==w*h*4)throw Error('Quadro da câmera incompleto');
 const gray=new Uint8Array(w*h),hist=new Uint32Array(256);
 let total=0;
 for(let i=0,j=0;i<rgba.length;i+=4,j++){
  const value=Math.round(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]);
  gray[j]=value;hist[value]++;total+=value;
 }
 let threshold=127,max=-1,count=0,sum=0;
 for(let t=0;t<256;t++){
  count+=hist[t];sum+=t*hist[t];
  if(!count||count===gray.length)continue;
  const a=sum/count,b=(total-sum)/(gray.length-count);
  const between=count*(gray.length-count)*(a-b)*(a-b);
  if(between>max){max=between;threshold=t}
 }
 for(let i=0;i<gray.length;i++)gray[i]=gray[i]<=threshold?1:0;
 return gray;
}
function detectCorners(mask,w,h){
 // Procura padrões quadrados por TODA a imagem, não apenas nas bordas do vídeo.
 // Assim funciona quando a folha ainda está pequena e centralizada.
 const visited=new Uint8Array(w*h),queue=new Int32Array(w*h);
 const minSize=Math.max(6,Math.floor(Math.min(w,h)*.012));
 const maxSize=Math.floor(Math.min(w,h)*.18);
 const candidates=[];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const pos=y*w+x;
  if(visited[pos]||!mask[pos])continue;
  let head=0,tail=1,count=0,minX=x,maxX=x,minY=y,maxY=y;
  visited[pos]=1;queue[0]=pos;
  while(head<tail){
   const index=queue[head++],px=index%w,py=(index/w)|0;
   count++;minX=Math.min(minX,px);maxX=Math.max(maxX,px);
   minY=Math.min(minY,py);maxY=Math.max(maxY,py);
   const neighbors=[px>0?index-1:-1,px<w-1?index+1:-1,
                    py>0?index-w:-1,py<h-1?index+w:-1];
   for(let k=0;k<4;k++){
    const n=neighbors[k];
    if(n<0||visited[n]||!mask[n])continue;
    visited[n]=1;queue[tail++]=n;
   }
  }
  const bw=maxX-minX+1,bh=maxY-minY+1,aspect=bw/bh;
  if(bw<minSize||bh<minSize||bw>maxSize||bh>maxSize||aspect<.73||aspect>1.33)continue;
  const fill=count/(bw*bh);
  if(fill<.23||fill>.88)continue;
  // Moldura dos marcadores: bordas escuras, centro com espaço branco.
  let perimeter=0,perimeterTotal=0,center=0,centerTotal=0;
  const inset=Math.min(2,Math.max(0,Math.floor(Math.min(bw,bh)*.075)));
  for(let k=0;k<=12;k++){
   const xx=minX+Math.round((bw-1)*k/12),yy=minY+Math.round((bh-1)*k/12);
   perimeter+=mask[(minY+inset)*w+xx]+mask[(maxY-inset)*w+xx];
   perimeter+=mask[yy*w+minX+inset]+mask[yy*w+maxX-inset];
   perimeterTotal+=4;
  }
  for(let dy=.30;dy<=.70;dy+=.20)for(let dx=.30;dx<=.70;dx+=.20){
   center+=mask[(minY+Math.round((bh-1)*dy))*w+minX+Math.round((bw-1)*dx)];
   centerTotal++;
  }
  const edgeRate=perimeter/perimeterTotal,centerRate=center/centerTotal;
  if(edgeRate<.62||centerRate>.80)continue;
  const size=(bw+bh)/2,cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  const quality=edgeRate+(1-centerRate)*.3-Math.abs(aspect-1)*.4;
  candidates.push({x:cx,y:cy,size,quality});
 }
 // Marcadores reais têm dimensões semelhantes e formam um retângulo amplo.
 candidates.sort((a,b)=>b.size-a.size||b.quality-a.quality);
 const possible=candidates.slice(0,70);
 let best=null,bestScore=-Infinity;
 function nearest(x,y,size,excludeA,excludeB){
  let winner=null,smallest=Infinity;
  for(let i=0;i<possible.length;i++){
   if(i===excludeA||i===excludeB)continue;
   const p=possible[i];
   if(p.size<size*.55||p.size>size*1.7)continue;
   const distance=Math.hypot(p.x-x,p.y-y);
   if(distance<smallest){winner={...p,id:i,distance};smallest=distance}
  }
  return winner;
 }
 for(let i=0;i<possible.length;i++)for(let j=0;j<possible.length;j++){
  if(i===j)continue;
  const tl=possible[i],br=possible[j];
  const dx=br.x-tl.x,dy=br.y-tl.y;
  if(dx<w*.27||dy<h*.25)continue;
  const size=(tl.size+br.size)/2;
  if(tl.size<size*.65||br.size<size*.65)continue;
  const tr=nearest(br.x,tl.y,size,i,j);
  const bl=nearest(tl.x,br.y,size,i,j);
  if(!tr||!bl||tr.id===bl.id)continue;
  const tolerance=Math.max(dx,dy)*.21;
  if(tr.distance>tolerance||bl.distance>tolerance)continue;
  const ratios=[tl.size,tr.size,bl.size,br.size];
  if(Math.max(...ratios)/Math.min(...ratios)>1.7)continue;
  const polygon=(dx*dy)/(w*h);
  const geometry=(tr.distance+bl.distance)/(dx+dy);
  const quality=(tl.quality+tr.quality+bl.quality+br.quality)/4;
  const score=polygon*8+quality-geometry*2;
  if(score>bestScore){bestScore=score;best={tl,tr,bl,br,horizontal:dx,vertical:dy}}
 }
 if(best)return {corners:best,count:4,points:best};
 // Mostrar pontos parciais sem anunciar um reconhecimento completo.
 // Escolhe somente marcadores plausíveis, semelhantes em tamanho e separados.
 const partial=[];
 const largest=possible[0]?.size||0;
 const keep=possible.filter(p=>p.size>=Math.max(minSize,largest*.68)&&p.quality>.72);
 for(const p of keep){
  if(partial.length===4)break;
  if(partial.every(x=>Math.hypot(x.x-p.x,x.y-p.y)>Math.max(x.size,p.size)*2.4))
   partial.push({x:p.x,y:p.y,size:p.size});
 }
 return {corners:null,count:Math.min(3,partial.length),points:partial};
}
function sample(mask,w,h,x,y,rx,ry){
 const xa=Math.max(0,Math.floor(x-rx)),xb=Math.min(w-1,Math.ceil(x+rx));
 const ya=Math.max(0,Math.floor(y-ry)),yb=Math.min(h-1,Math.ceil(y+ry));
 let filled=0,total=0;
 for(let yy=ya;yy<=yb;yy++)for(let xx=xa;xx<=xb;xx++){
  const dx=(xx-x)/rx,dy=(yy-y)/ry;
  if(dx*dx+dy*dy>1)continue;
  filled+=mask[yy*w+xx];total++;
 }
 return total?filled/total:0;
}
function locate(mask,w,h,anchors){
 const cornerPoint=(u,v)=>{
  const a=anchors;
  return {x:a.tl.x*(1-u)*(1-v)+a.tr.x*u*(1-v)+a.bl.x*(1-u)*v+a.br.x*u*v,
          y:a.tl.y*(1-u)*(1-v)+a.tr.y*u*(1-v)+a.bl.y*(1-u)*v+a.br.y*u*v};
 };
 const orient=(u,v,rotation)=>{
  if(rotation===180)return [1-u,1-v];
  if(rotation===90)return [1-v,u];
  if(rotation===270)return [v,1-u];
  return [u,v];
 };
 const point=(u,v,rotation)=>{
  const [x,y]=orient(u,v,rotation);return cornerPoint(x,y);
 };
 const inkNear=(p)=>{
  const x=Math.round(p.x),y=Math.round(p.y);
  if(x<2||x>=w-2||y<2||y>=h-2)return 0;
  return mask[y*w+x]||mask[(y-1)*w+x]||mask[(y+1)*w+x]||mask[y*w+x-1]||mask[y*w+x+1]?1:0;
 };
 let orientation=0,confidence=-1;
 for(const degrees of [0,90,180,270]){
  let found=0,total=0;
  for(const y of [.428,.477,.939]){
   for(let i=0;i<=70;i++){
    const u=.012+.974*i/70;
    found+=inkNear(point(u,y,degrees));total++;
   }
  }
  const ratio=found/total;
  if(ratio>confidence){confidence=ratio;orientation=degrees}
 }
 if(confidence<.54)return {error:'Enquadre a grade completa do cartão',corners:anchors,orientationConfidence:confidence,boxes:[],results:[]};
 const rx=Math.max(2,anchors.horizontal*.0055),ry=Math.max(2,anchors.vertical*.0080);
 const cols=[.0377,.0720],step=.0993;
 const valueRows=d=>.5035+d*.0446;
 const boxes=[],results=[];
 for(let q=0;q<10;q++){
  const columns=[];
  for(let c=0;c<2;c++){
   const readings=[];
   for(let d=0;d<(c===0?2:10);d++){
    const p=point(cols[c]+q*step,valueRows(d),orientation);
    const value=sample(mask,w,h,p.x,p.y,rx,ry);
    readings.push({digit:d,fill:value,x:p.x,y:p.y});
   }
   const options=readings.map(r=>({digit:r.digit,x:r.x,y:r.y,fill:r.fill}));
   readings.sort((a,b)=>b.fill-a.fill);
   const first=readings[0],second=readings[1],confident=first.fill>=.69&&first.fill-second.fill>=.16;
   columns.push({digit:confident?first.digit:null,candidate:first.digit,confidence:first.fill-second.fill,
     x:first.x,y:first.y,fill:first.fill,options});
  }
  const value=columns.every(c=>c.digit!==null)?columns[0].digit*10+columns[1].digit:null;
  const valid=value!==null&&value<=15;
  results.push({columns,value:valid?value:null,rawValue:value,valid,error:value>15?'Somatória acima de 15':null});
  const quad=[
    point(.009+q*step,.429,orientation),
    point(.009+(q+.945)*step,.429,orientation),
    point(.009+(q+.945)*step,.938,orientation),
    point(.009+q*step,.938,orientation)
  ];
  const xs=quad.map(p=>p.x),ys=quad.map(p=>p.y);
  boxes.push({quad,x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)});
 }
 return {boxes,results,corners:anchors,orientation,orientationConfidence:confidence};
}
function decode(input){
 const w=input.width,h=input.height;
 const binary=binaryFromRGBA(input);
 const detection=detectCorners(binary,w,h);
 if(!detection.corners)return {error:'Ajuste os quatro marcadores dentro do guia',boxes:[],results:[],markersFound:detection.count,markerPoints:detection.points};
 const corners=detection.corners;
 const res=locate(binary,w,h,corners);
 return {...res,markersFound:4,markerPoints:corners};
}
self.onmessage=function(event){
 const data=event.data||{};
 if(data.action!=='analyze')return;
 try{self.postMessage({id:data.id,status:'ok',result:decode(data)})}
 catch(e){self.postMessage({id:data.id,status:'error',message:String(e?.message||e)})}
};