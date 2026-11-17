/**
 * BACKEND OFICIAL - SISTEMA DE AVALIAÇÃO PSS 1 / UEPG (2026)
 * Padrão: 4 Proposições (01, 02, 04, 08) - Soma máxima 15
 * Colégio Estadual Padre Nicolau Baltazar - EF M (Castro - PR)
 *
 * INSTRUÇÕES DE IMPLANTAÇÃO:
 * 1. Abra a planilha 'Sistema_PSS1_Matematica_2026_4Prop' no Google Sheets.
 * 2. Vá em Extensões -> Apps Script.
 * 3. Apague o conteúdo existente, cole este código inteiro e salve (Ctrl+S).
 * 4. Clique em Implantar -> Nova implantação -> Tipo: App da Web.
 * 5. Executar como: Eu (seu e-mail) | Quem tem acesso: Qualquer pessoa.
 * 6. Copie a URL gerada (https://script.google.com/macros/s/.../exec) e cole nas configurações do App.
 */

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet1A = ss.getSheetByName('1A');
    var sheet1B = ss.getSheetByName('1B');
    var sheetBanco = ss.getSheetByName('Banco_Questoes');

    var data = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      turmas: {
        '1A': sheetToObjects_(sheet1A),
        '1B': sheetToObjects_(sheet1B)
      },
      banco: sheetToObjects_(sheetBanco)
    };

    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var payload = JSON.parse(e.postData.contents);
    var records = Array.isArray(payload.records) ? payload.records : [payload];
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var updatedCount = 0;

    records.forEach(function(rec) {
      var turma = String(rec.turma || '').trim();
      var num = Number(rec.num);
      var sheet = ss.getSheetByName(turma);
      if (!sheet || !num) return;

      var values = sheet.getDataRange().getValues();
      for (var i = 1; i < values.length; i++) {
        if (Number(values[i][0]) === num) {
          var rowIdx = i + 1;
          var qScores = rec.scores || []; // Array com 10 notas [0..1]
          sheet.getRange(rowIdx, 5).setValue('Corrigida'); // Coluna E: Status
          for (var q = 0; q < 10; q++) {
            var val = (typeof qScores[q] === 'number') ? Number(qScores[q].toFixed(2)) : 0;
            sheet.getRange(rowIdx, 6 + q).setValue(val); // Colunas F..O: Q01..Q10
          }
          sheet.getRange(rowIdx, 17).setValue(rec.updatedAt || new Date().toLocaleString('pt-BR')); // Coluna Q: Atualizado_Em
          updatedCount++;
          break;
        }
      }
    });

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', updated: updatedCount }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function sheetToObjects_(sheet) {
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];
  var headers = rows[0].map(function(h) { return String(h).trim(); });
  var result = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === '' && rows[i][1] === '') continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = rows[i][j];
    }
    result.push(obj);
  }
  return result;
}
