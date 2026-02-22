/**
 * Скрипт для таблиці Реєстру рішень.
 * Надсилає email-сповіщення членам правління при новій пропозиції.
 * 
 * Тригер: onFormSubmit (встановити вручну — див. інструкцію нижче)
 */

const REGISTRY_CONFIG = {
  votingSheetName: "Голосування",
  membersSheetName: "Члени правління",   // Аркуш зі списком правління
  membersEmailCol: 1,                    // Стовпчик A з email (змініть на ваш)
  
  // Стовпчики у "Відповіді форми" (відповідно до порядку полів форми)
  formDateCol: 1,      // A — Timestamp
  formAuthorCol: 2,    // B — Email автора
  formAptsCol: 3,      // C — Квартири
  formDescCol: 4,      // D — Опис пропозиції
  formFilesCol: 5      // E — Файли (посилання)
};

/**
 * Екранує HTML-символи для безпечного виводу в email
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

/**
 * Обробник нової відповіді форми.
 * Встановіть тригер: Triggers → Add Trigger → notifyBoardOnNewProposal → From spreadsheet → On form submit
 */
function notifyBoardOnNewProposal(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Дані з нового запису форми
  const row = e.range.getRow();
  const sheet = e.range.getSheet();
  const rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  const timestamp = rowData[REGISTRY_CONFIG.formDateCol - 1];
  const authorEmail = String(rowData[REGISTRY_CONFIG.formAuthorCol - 1]).trim();
  const apartments = String(rowData[REGISTRY_CONFIG.formAptsCol - 1]).trim();
  const description = String(rowData[REGISTRY_CONFIG.formDescCol - 1]).trim();
  const filesRaw = String(rowData[REGISTRY_CONFIG.formFilesCol - 1]).trim();

  // Екрануємо HTML і замінюємо \n на <br>
  const descriptionHtml = escapeHtml(description);

  // Формуємо дату
  const tz = Session.getScriptTimeZone();
  const dateStr = timestamp instanceof Date
    ? Utilities.formatDate(timestamp, tz, "dd.MM.yyyy HH:mm")
    : String(timestamp);

  // Посилання на рядок у аркуші "Голосування"
  const votingSheet = ss.getSheetByName(REGISTRY_CONFIG.votingSheetName);
  const votingRow = row + 1; // +1, бо заголовок на 1 рядок більше
  const votingUrl = ss.getUrl() + "#gid=" + votingSheet.getSheetId() + "&range=" + votingRow + ":" + votingRow;

  // Формуємо блок файлів
  let filesHtml = "";
  if (filesRaw && filesRaw !== "undefined" && filesRaw !== "") {
    const fileLinks = filesRaw.split(",").map(function(f) { return f.trim(); }).filter(Boolean);
    if (fileLinks.length > 0) {
      filesHtml = "<p><b>📎 Додані файли:</b><br>" +
        fileLinks.map(function(link, i) {
          return '<a href="' + link + '">Файл ' + (i + 1) + '</a>';
        }).join(" &nbsp;|&nbsp; ") +
        "</p>";
    }
  }

  // Формуємо HTML листа
  const htmlBody = '<!DOCTYPE html><html><body style="font-family: Arial, sans-serif; color: #333;">' +
    '<div style="max-width: 600px; margin: 0 auto;">' +
      '<h2 style="color: #1a73e8;">📋 Нова пропозиція в Реєстрі рішень</h2>' +
      '<table style="width: 100%; border-collapse: collapse;">' +
        '<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><b>Дата:</b></td>' +
            '<td style="padding: 8px; border-bottom: 1px solid #eee;">' + dateStr + '</td></tr>' +
        '<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><b>Автор:</b></td>' +
            '<td style="padding: 8px; border-bottom: 1px solid #eee;">' + authorEmail + '</td></tr>' +
        '<tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><b>Квартири:</b></td>' +
            '<td style="padding: 8px; border-bottom: 1px solid #eee;">' + apartments + '</td></tr>' +
        '<tr><td style="padding: 8px; vertical-align: top;"><b>Опис:</b></td>' +
            '<td style="padding: 8px;">' + descriptionHtml + '</td></tr>' +
      '</table>' +
      filesHtml +
      '<p style="margin-top: 24px; text-align: center;">' +
        '<a href="' + votingUrl + '" style="display: inline-block; padding: 12px 24px; ' +
          'background-color: #1a73e8; color: #ffffff; text-decoration: none; ' +
          'border-radius: 4px; font-weight: bold;">🗳️ Перейти до голосування</a>' +
      '</p>' +
      '<p style="color: #999; font-size: 12px; margin-top: 16px; text-align: center;">' +
        'Цей лист надіслано автоматично з Реєстру рішень ОК Синевир.</p>' +
    '</div>' +
  '</body></html>';

  // Отримуємо список email правління
  const emails = getBoardEmails(ss);
  if (emails.length === 0) {
    console.log("Список email членів правління порожній!");
    return;
  }

  // Надсилаємо
  try {
    MailApp.sendEmail({
      to: emails.join(","),
      subject: "📋 Нова пропозиція: " + description.substring(0, 50),
      htmlBody: htmlBody
    });
    console.log("Сповіщення надіслано " + emails.length + " членам правління");
  } catch (err) {
    console.log("Помилка надсилання: " + err.message);
  }
}

/**
 * Збирає email-адреси членів правління
 */
function getBoardEmails(ss) {
  const sheet = ss.getSheetByName(REGISTRY_CONFIG.membersSheetName);
  if (!sheet) {
    console.log("Аркуш '" + REGISTRY_CONFIG.membersSheetName + "' не знайдено");
    return [];
  }
  
  const data = sheet.getRange(2, REGISTRY_CONFIG.membersEmailCol, sheet.getLastRow() - 1, 1).getValues();
  var emails = [];
  
  data.forEach(function(row) {
    var email = String(row[0]).trim();
    if (email && email.indexOf("@") > -1) {
      emails.push(email);
    }
  });
  
  return emails;
}