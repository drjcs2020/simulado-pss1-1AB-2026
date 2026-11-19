import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {realCardCrops} from './fixtures/real-card-crops';
import {scanPhotoBase64} from '../src/photo-omr';
const jpeg=require('jpeg-js') as {encode:(image:{data:Uint8Array;width:number;height:number},quality:number)=>{data:Uint8Array}};
import {parseStudentQR,ROSTERS} from '../src/data';
import {grade,scoreQuestion,toggleBit} from '../src/scoring';
import {decodeBinary,luminanceToBinary,stableReading} from '../src/omr';

test('turmas e QR pertencem aos alunos cadastrados',()=>{
 assert.equal(ROSTERS['1A'].length,21);
 assert.equal(ROSTERS['1B'].length,25);
 assert.deepEqual(parseStudentQR('PSS1|1A|01|A'),{group:'1A',num:1,type:'A'});
 assert.equal(parseStudentQR('PSS1|1A|01|C'),null);
});
test('pontuação por proposições: integral, parcial, incorreta',()=>{
 assert.equal(scoreQuestion(11,11),1);
 assert.equal(scoreQuestion(2,14),0.33);
 assert.equal(scoreQuestion(15,11),0);
 assert.equal(toggleBit(0,8),8);
 assert.equal(grade([11,5,14,11,13,7,14,11,13,7],'A').total,10);
 assert.throws(()=>grade(Array(10).fill(null),'A'));
});
function card(scale:number,slope:number){
 const width=640,height=480,expected=[15,13,8,0,5,6,7,12,13,15],dark=new Uint8Array(width*height);
 const dot=(x:number,y:number)=>{x=Math.round(x);y=Math.round(y);if(x>=0&&x<width&&y>=0&&y<height)dark[y*width+x]=255};
 const line=(x0:number,y0:number,x1:number,y1:number)=>{
  const steps=Math.ceil(2*Math.max(Math.abs(x1-x0),Math.abs(y1-y0)));
  for(let j=0;j<=steps;j++)dot(x0+(x1-x0)*j/steps,y0+(y1-y0)*j/steps);
 };
 const cw=53*scale,gap=5*scale,ch=196*scale,x0=(width-(10*cw+9*gap))/2,y0=(height-ch)/2;
 for(let q=0;q<10;q++){
  const left=x0+q*(cw+gap),top=y0+slope*(left-width/2);
  line(left,top,left+cw,top+slope*cw);
  line(left,top+ch,left+cw,top+slope*cw+ch);
  line(left,top,left,top+ch);
  line(left+cw,top+slope*cw,left+cw,top+slope*cw+ch);
  for(const [frac,digit] of [[.329,Math.floor(expected[q]/10)],[.673,expected[q]%10]]){
   const cx=left+cw*frac,cy=top+slope*cw*frac+ch*(.149+.0855*digit);
   for(let dx=-3;dx<=3;dx++)for(let dy=-3;dy<=3;dy++)dot(cx+dx,cy+dy);
  }
 }
 return {dark,width,height,expected};
}
test('OMR 12 variações de escala e inclinação, incluindo resposta 00',()=>{
 for(const scale of [1,.75,.55,.4])for(const slope of [0,.05,-.05]){
  const {dark,width,height,expected}=card(scale,slope);
  const result=decodeBinary(dark,width,height);
  assert.equal(result.error,undefined,'escala='+scale+', inclinação='+slope);
  assert.deepEqual(result.results.map(x=>x.value),expected);
  assert.equal(result.boxes.length,10);
 }
});
test('só estabiliza com três quadros idênticos',()=>{
 const detected=decodeBinary(...((({dark,width,height})=>[dark,width,height] as const)(card(.75,0))));
 const first=stableReading({signature:'',count:0},detected);
 assert.equal(first.stable,false);
 const second=stableReading({signature:first.signature,count:first.count},detected);
 assert.equal(second.stable,false);
 const third=stableReading({signature:second.signature,count:second.count},detected);
 assert.equal(third.stable,true);
 const empty=stableReading({signature:third.signature,count:third.count},null);
 assert.equal(empty.stable,false);
});

test('fallback CPU lê plano de luminância YUV com padding e sem Vulkan',()=>{
 const {dark,width,height,expected}=card(.75,0);
 const bytesPerRow=width+16; // Padding realista de câmera.
 const yPlane=new Uint8Array(bytesPerRow*height);yPlane.fill(255);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  yPlane[y*bytesPerRow+x]=dark[y*width+x]?0:255;
 }
 const bin=luminanceToBinary(yPlane,width,height,bytesPerRow,width,height);
 const decoded=decodeBinary(bin,width,height);
 assert.equal(decoded.error,undefined);
 assert.deepEqual(decoded.results.map(r=>r.value),expected);
 assert.equal(bin.length,width*height);
});
test('fallback CPU rejeita buffer sem plano Y completo',()=>{
 assert.throws(()=>luminanceToBinary(new Uint8Array(5),640,480,640));
});

test('OMR reconhece dois cartões reais anonimizados, incluindo somatório 00',()=>{
 for(const fixture of realCardCrops){
  const binary=new Uint8Array(inflateSync(Buffer.from(fixture.compressed,'base64')));
  assert.equal(binary.length,fixture.width*fixture.height,fixture.title);
  const result=decodeBinary(binary,fixture.width,fixture.height);
  assert.equal(result.error,undefined,fixture.title);
  assert.deepEqual(result.results.map(r=>r.value),[...fixture.expected],fixture.title);
  assert.equal(result.boxes.length,10,fixture.title);
 }
});

test('leitura CPU de cartões reais em enquadramento vertical e ampliação para 640x480',()=>{
 for(const fixture of realCardCrops){
  const binary=new Uint8Array(inflateSync(Buffer.from(fixture.compressed,'base64')));
  const stride=fixture.width+32;
  const yPlane=new Uint8Array(stride*fixture.height).fill(255);
  for(let y=0;y<fixture.height;y++){
   for(let x=0;x<fixture.width;x++){
    yPlane[y*stride+x]=binary[y*fixture.width+x]===255?0:255;
   }
  }
  const processed=luminanceToBinary(yPlane,fixture.width,fixture.height,stride,640,480);
  const result=decodeBinary(processed,640,480);
  assert.equal(result.error,undefined,fixture.title);
  assert.deepEqual(result.results.map(r=>r.value),[...fixture.expected],fixture.title);
 }
});

