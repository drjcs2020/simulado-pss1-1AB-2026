import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {printedCardFixture} from './fixtures/printed-matrix';
import {decodePrintedCard} from '../src/printed-card-omr';
import {scanPhotoBase64} from '../src/photo-omr';
const jpeg=require('jpeg-js') as {encode:(image:{data:Uint8Array;width:number;height:number},quality:number)=>{data:Uint8Array}};

const {width,height,expected}=printedCardFixture;
const binary=new Uint8Array(inflateSync(Buffer.from(printedCardFixture.compressed,'base64')));
function jpegCard(rotation:0|90|180=0){
 const w=rotation===90?height:width;
 const h=rotation===90?width:height;
 const rgba=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let sx=x,sy=y;
  if(rotation===180){sx=width-1-x;sy=height-1-y}
  if(rotation===90){sx=y;sy=height-1-x}
  const ink=binary[sy*width+sx];
  const i=(y*w+x)*4,v=ink===255?0:255;
  rgba[i]=v;rgba[i+1]=v;rgba[i+2]=v;rgba[i+3]=255;
 }
 return Buffer.from(jpeg.encode({data:rgba,width:w,height:h},95).data).toString('base64');
}
test('detector lê a grade impressa 10x4 de um recorte REAL do PDF, não a grade decimal anterior',()=>{
 assert.equal(binary.length,width*height);
 const reading=decodePrintedCard(binary,width,height);
 assert.equal(reading.error,undefined);
 assert.deepEqual(reading.results.map(x=>x.value),[...expected]);
 assert.equal(reading.boxes.length,10);
 assert.equal(reading.results[5].value,0,'questão totalmente sem círculos preenchidos equivale a 00');
 assert.equal(reading.results[4].value,15,'quatro proposições preenchidas somam 15');
 assert.equal(reading.results.every(x=>x.columns.length===4),true);
});
test('pipeline de JPEG identifica as dez respostas do cartão impresso',()=>{
 const reading=scanPhotoBase64(jpegCard());
 assert.equal(reading.accepted,10);
 assert.deepEqual(reading.detection.results.map(x=>x.value),[...expected]);
});
test('pipeline de JPEG aceita cartão girado em 180 graus',()=>{
 const reading=scanPhotoBase64(jpegCard(180));
 assert.equal(reading.accepted,10);
 assert.deepEqual(reading.detection.results.map(x=>x.value),[...expected]);
});
test('pipeline de JPEG aceita imagem de câmera em retrato',()=>{
 const reading=scanPhotoBase64(jpegCard(90));
 assert.equal(reading.accepted,10);
 assert.deepEqual(reading.detection.results.map(x=>x.value),[...expected]);
});
test('detector não inventa notas em foto sem grade',()=>{
 const blank=new Uint8Array(400*300);
 const reading=decodePrintedCard(blank,400,300);
 assert.ok(reading.error);
 assert.equal(reading.results.length,0);
});
