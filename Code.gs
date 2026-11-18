/**
 * Backend do Simulado PSS1 2026.
 * Esta fonte deve estar implantada como Web App do Google Apps Script
 * vinculado à planilha de ID definido abaixo.
 *
 * Segurança: restringir o acesso ao aplicativo a professores autorizados.
 * Não divulgar a URL de gravação em páginas públicas sem autenticação.
 */
var SPREADSHEET_ID = '1pla54S48l9lwS7sM7krVnHyZYL_e_oJqMJ-NkMV5SGI';
var KEYS = {
  A: [11,5,14,11,13,7,14,11,13,7],
  B: [13,3,7,13,11,14,11,7,14,13],
  C: [7,10,11,7,14,13,7,13,11,14]
};
function response_(body){
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
function workbook_(){ return SpreadsheetApp.openById(SPREADSHEET_ID); }
function score_(mark,key){
  if(mark===0||(mark&(~key))!==0)return 0;
  var hit=0,total=0;
  for(var i=0;i<4;i++){if((key>>i)&1)total++;if((mark>>i)&1)hit++;}
  return total?Math.round(100*hit/total)/100:0;
}
function doGet(e){
  try{
    var ss=workbook_(), action=e&&e.parameter&&e.parameter.action||'ping';
    if(action==='ping')return response_({status:'ok',service:'PSS1-2026',version:2});
    if(action!=='data')return response_({status:'error',message:'Ação não permitida'});
    return response_({status:'ok',version:2,turmas:{
      '1A':sheetToObjects_(ss.getSheetByName('1A')),
      '1B':sheetToObjects_(ss.getSheetByName('1B'))
    }});
  }catch(err){return response_({status:'error',message:String(err)});}
}
function doPost(e){
  var lock=LockService.getScriptLock(),locked=false;
  try{
    locked=lock.tryLock(10000);
    if(!locked)throw new Error('Outra gravação está em andamento. Repita a sincronização.');
    if(!e||!e.postData||!e.postData.contents)throw new Error('Requisição vazia.');
    var payload=JSON.parse(e.postData.contents);
    var records=Array.isArray(payload.records)?payload.records:[payload];
    if(records.length===0||records.length>50)throw new Error('Quantidade de registros inválida.');
    var ss=workbook_(),done=[],errors=[];
    var history=ss.getSheetByName('Historico_Leituras');
    if(!history){
      history=ss.insertSheet('Historico_Leituras');
      history.appendRow(['Timestamp_Servidor','Turma','N_Chamada','Estudante','Tipo','Origem',
        'R01','R02','R03','R04','R05','R06','R07','R08','R09','R10',
        'Q01','Q02','Q03','Q04','Q05','Q06','Q07','Q08','Q09','Q10','Nota_Final']);
    }
    records.forEach(function(rec){
      var turma=String(rec.turma||''),num=Number(rec.num);
      var id=turma+'|'+num;
      try{
        if(!/^(1A|1B)$/.test(turma)||!Number.isInteger(num))throw new Error('Aluno inválido.');
        var sheet=ss.getSheetByName(turma),rows=sheet.getRange(1,1,sheet.getLastRow(),4).getValues(),rowIndex=-1;
        for(var i=1;i<rows.length;i++)if(Number(rows[i][0])===num){rowIndex=i+1;break;}
        if(rowIndex<0)throw new Error('Aluno não encontrado.');
        var type=String(rows[rowIndex-1][2]);
        if(type!==rec.type||!KEYS[type])throw new Error('Tipo da prova não corresponde à matrícula.');
        if(!Array.isArray(rec.marks)||rec.marks.length!==10||
           !rec.marks.every(function(v){return typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=15;}))
          throw new Error('Somatórias inválidas.');
        var scores=rec.marks.map(function(v,i){return score_(v,KEYS[type][i]);});
        var total=Math.round(scores.reduce(function(a,b){return a+b;},0)*100)/100;
        // Histórico primeiro, para manter auditoria das dez respostas efetivamente recebidas.
        var now=new Date();
        history.appendRow([now,turma,num,rows[rowIndex-1][1],type,String(rec.source||'manual')]
          .concat(rec.marks,scores,[total]));
        sheet.getRange(rowIndex,5,1,11).setValues([['Corrigida'].concat(scores)]);
        sheet.getRange(rowIndex,17).setValue(now);
        SpreadsheetApp.flush();
        done.push({turma:turma,num:num,total:total,version:2});
      }catch(error){errors.push({turma:turma,num:num,message:String(error.message||error)});}
    });
    return response_({status:errors.length===0?'ok':'partial',updated:done.length,acknowledged:done,errors:errors,version:2});
  }catch(error){return response_({status:'error',message:String(error.message||error),updated:0,acknowledged:[]});}
  finally{if(locked)lock.releaseLock();}
}
function sheetToObjects_(sheet){
  if(!sheet)return [];
  var values=sheet.getDataRange().getValues();
  if(values.length<2)return [];
  var headers=values[0].map(function(v){return String(v).trim();});
  return values.slice(1).filter(function(row){return row[0]!==''&&row[1]!=='';}).map(function(row){
    var obj={};headers.forEach(function(key,i){obj[key]=row[i]});return obj;
  });
}
