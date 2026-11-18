import {ANSWER_KEYS, ClassId, ExamType} from './data';
export type Mark = number | null;
export function scoreQuestion(mask: Mark, correct:number): number {
 if(mask === null || !Number.isInteger(mask) || mask < 0 || mask > 15) return 0;
 if((mask & ~correct) !== 0) return 0;
 let right = 0, picked = 0;
 for(const bit of [1,2,4,8]) {if(correct & bit) right++;if(mask & bit) picked++;}
 return right ? Math.round(100 * picked/right)/100 : 0;
}
export function grade(marks:Mark[],type:ExamType) {
 if(marks.length !== 10 || marks.some(m=>m === null || !Number.isInteger(m) || m<0 || m>15))
   throw new Error('Confira todas as dez respostas antes de salvar.');
 const scores=marks.map((m,i)=>scoreQuestion(m,ANSWER_KEYS[type][i]));
 const total=Math.round(scores.reduce((a,b)=>a+b,0)*100)/100;
 return {scores,total};
}
export function toggleBit(value:Mark,bit:1|2|4|8):Mark {
 return (value ?? 0)^bit;
}
export function normaliseMarks(source:unknown):Mark[] {
 if(!Array.isArray(source)||source.length!==10)throw Error('São necessárias 10 respostas.');
 return source.map(x=>Number.isInteger(x)&&x>=0&&x<=15?x:null);
}
