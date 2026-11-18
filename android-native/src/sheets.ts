import AsyncStorage from '@react-native-async-storage/async-storage';
import {ClassId, Student} from './data';
import {grade, Mark} from './scoring';
const SETTINGS='pss1_native_script_url';
const PENDING='pss1_native_pending';
export type GradeRecord={turma:ClassId,num:number,name:string,type:Student['type'],marks:number[],scores:number[],total:number,updatedAt:string,replace:boolean};
export async function loadEndpoint(){return (await AsyncStorage.getItem(SETTINGS)) || ''}
export async function setEndpoint(url:string){
 if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(url))
  throw Error('Informe a URL /exec do Apps Script.');
 await AsyncStorage.setItem(SETTINGS,url.trim());
}
function target(url:string,action:string){
 return url + (url.includes('?')?'&':'?')+'action='+encodeURIComponent(action)+'&_='+Date.now();
}
async function json(response:Response){
 if(!response.ok)throw Error('Erro de rede HTTP '+response.status);
 const text=await response.text();
 try{return JSON.parse(text)}catch{throw Error('O Apps Script não devolveu JSON; verifique implantação e permissões.')}
}
export async function readSheet(url:string){
 const result=await json(await fetch(target(url,'data')));
 if(result.status!=='ok'||!result.turmas?.['1A']||!result.turmas?.['1B'])
  throw Error(result.message||'Resposta inválida do Google Sheets.');
 return result;
}
export async function saveGrade(url:string,group:ClassId,student:Student,marks:Mark[]){
 const numeric=marks.map(x=>x as number);
 const {scores,total}=grade(marks,student.type);
 const record:GradeRecord={turma:group,num:student.num,name:student.name,type:student.type,marks:numeric,scores,total,updatedAt:new Date().toISOString(),replace:true};
 // Guardar para recuperação; NÃO indicar salvo até confirmação remota.
 await AsyncStorage.setItem(PENDING,JSON.stringify(record));
 const before=await readSheet(url);
 const result=await json(await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({records:[record]})}));
 if(result.status!=='ok'||Number(result.updated)<1)throw Error(result.message||'Planilha não confirmou a gravação.');
 const after=await readSheet(url);
 const row=after.turmas[group].find((r:Record<string,unknown>)=>Number(r['Nº'])===student.num);
 if(!row||row.Status!=='Corrigida')throw Error('A planilha ainda não confirmou a correção.');
 for(let i=0;i<10;i++){
  const value=Number(String(row['Q'+String(i+1).padStart(2,'0')]).replace(',','.'));
  if(!Number.isFinite(value)||Math.abs(value-scores[i])>.011)throw Error('Nota diferente na planilha; não marque como concluído.');
 }
 await AsyncStorage.removeItem(PENDING);
 return total;
}
export async function pendingGrade():Promise<GradeRecord|null>{
 try{const s=await AsyncStorage.getItem(PENDING);return s?JSON.parse(s):null}catch{return null}
}
export async function resetGrade(url:string,group:ClassId,student:Student){
 const sheet=await readSheet(url);
 if(Number(sheet.version)<4)throw Error('Apps Script antigo: publique a versão 4 para reset.');
 const reply=await json(await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'reset',scope:'student',turma:group,num:student.num,confirmed:true})}));
 if(reply.status!=='ok'||reply.action!=='reset'||!reply.reset?.some((x:{turma:string,num:number})=>x.turma===group&&Number(x.num)===student.num))
  throw Error(reply.message||'O servidor não confirmou o reset.');
 const after=await readSheet(url);
 const row=after.turmas[group].find((r:Record<string,unknown>)=>Number(r['Nº'])===student.num);
 if(!row||row.Status!=='Pendente')throw Error('O Google Sheets não confirmou o aluno como Pendente.');
 const pending=await pendingGrade();
 if(pending?.turma===group&&pending.num===student.num)await AsyncStorage.removeItem(PENDING);
}
