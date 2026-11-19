import type {Detection} from './omr';
import {decodePrintedCard} from './printed-card-omr';

// JPEG pequeno (após redimensionamento nativo) -> pixels RGBA -> OMR.
// Dependências puramente JS: nenhum processador de quadros, Vulkan ou OpenCV.
const jpeg=require('jpeg-js') as {decode:(data:Uint8Array, opts:Record<string,unknown>)=>{data:Uint8Array;width:number;height:number}};
const base64=require('base64-js') as {toByteArray:(text:string)=>Uint8Array};

export type PhotoReading={detection:Detection;rotation:0|90|180|270;accepted:number;width:640;height:480};

export function rgbaToBinary(
 rgba:Uint8Array,width:number,height:number,rotation:0|90|180|270,
 outW=640,outH=480
):Uint8Array {
 if(width<1||height<1||rgba.length<width*height*4)throw Error('Imagem RGBA incompleta');
 const rotatedW=(rotation===90||rotation===270)?height:width;
 const rotatedH=(rotation===90||rotation===270)?width:height;
 const gray=new Uint8Array(outW*outH);
 const hist=new Uint32Array(256);
 for(let y=0;y<outH;y++){
  const v=Math.min(rotatedH-1,Math.floor((y+.5)*rotatedH/outH));
  for(let x=0;x<outW;x++){
   const u=Math.min(rotatedW-1,Math.floor((x+.5)*rotatedW/outW));
   let sx=u,sy=v;
   if(rotation===90){sx=v;sy=height-1-u;}
   else if(rotation===180){sx=width-1-u;sy=height-1-v;}
   else if(rotation===270){sx=width-1-v;sy=u;}
   const i=(sy*width+sx)*4;
   const g=Math.round(rgba[i]*.299+rgba[i+1]*.587+rgba[i+2]*.114);
   gray[y*outW+x]=g;hist[g]++;
  }
 }
 let totalSum=0;
 for(let t=0;t<256;t++)totalSum+=t*hist[t];
 let count=0,sum=0,best=-1,threshold=127;
 for(let t=0;t<256;t++){
  count+=hist[t];sum+=t*hist[t];
  if(count===0||count===gray.length)continue;
  const m0=sum/count,m1=(totalSum-sum)/(gray.length-count);
  const variance=count*(gray.length-count)*(m0-m1)*(m0-m1);
  if(variance>best){best=variance;threshold=t;}
 }
 for(let i=0;i<gray.length;i++)gray[i]=(gray[i]<=threshold?255:0);
 return gray;
}

export function scanPhotoBase64(base64Text:string):PhotoReading {
 const raw=base64Text.replace(/^data:image\/[^;]+;base64,/, '');
 const bytes=base64.toByteArray(raw);
 const {data,width,height}=jpeg.decode(bytes,{useTArray:true,formatAsRGBA:true,maxMemoryUsageInMB:64});
 if(!data||width<32||height<32)throw Error('Foto JPEG inválida');
 // A câmera pode retornar retrato ou paisagem. Nunca adivinhar qual lado é a questão 1.
 const rotations: Array<0|90|180|270>=[0,180,90,270];
 let best:PhotoReading|null=null;
 for(const rotation of rotations){
  const bin=rgbaToBinary(data,width,height,rotation);
  const detection=decodePrintedCard(bin,640,480);
  const accepted=detection.results.filter(r=>r.valid).length;
  const found:PhotoReading={detection,rotation,accepted,width:640,height:480};
  if(!best||accepted>best.accepted||(accepted===best.accepted&&detection.boxes.length>best.detection.boxes.length))best=found;
  if(accepted===10)break;
 }
 return best!;
}
