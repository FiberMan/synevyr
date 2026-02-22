const CONFIG = {
  // Налаштування для календаря - autoCancelBadBookings
  sheetName: "Учасники кооперативу",        // Назва аркуша з даними (замініть на вашу)
  queueSheetName: "Черга",                  // Аркуш для підтверджених записів
  eventTitle: "Підписання акту прийому-передачі", // Назва події, яку обробляємо
  flatColumnNum: 1,             // Стовпчик A (№ квартири)
  flatColumnStr: 3,             // Стовпчик C (№ квартири)
  nameColumn: 4,             // Стовпчик D (Ім'я)
  phoneColumn: 5,            // Стовпчик E (Телефон)
  emailColumn: 6,            // Стовпчик F (Email)
  debtColumn: 17,            // Стовпчик Q (Борг)
  logColumn: 26,             // Стовпчик Z (Логування статусу)
  startRow: 3,               // Початок даних
  endRow: 600,               // Кінець даних
  minFlat: 1,                // Мінімальний номер квартири
  maxFlat: 598,              // Максимальний номер квартири
  checkFieldName: "№ квартири", // Назва поля у формі календаря

  // Налаштування для Реєстру рішень - syncRegistryToPublic
  registrySpreadsheetId: "1ObHP1LvW5CkodkayOiPNYhg5XXoXriX_XpOhlG7AJ7c", // Скопіюйте з адресного рядка Реєстру
  registrySheetName: "Голосування",  // Аркуш з голосуванням
  registryStatusCol: 21,             // Стовпчик U (Виконано)
  registryNumCol: 1,                 // Стовпчик A (№ з/п для надійної ідентифікації рядка)
  registryAptCol: 4,                 // Стовпчик D (Номери квартир)
  registryDateCol: 2,                // Стовпчик B (Дата)
  registryDescCol: 5,                // Стовпчик E (Суть рішення)
  decisionsCol: 27                   // Стовпчик AA (Прийняті рішення)
};

function autoCancelBadBookings() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheetName);
  const calendar = CalendarApp.getDefaultCalendar();
  
  // Беремо події на найближчі 90 днів від початку сьогоднішнього дня
  const now = new Date();
  now.setHours(0, 0, 0, 0); // Початок сьогоднішнього дня
  const future = new Date(now.getTime() + (90 * 24 * 60 * 60 * 1000));
  const events = calendar.getEvents(now, future);
  
  // Сортуємо події по даті для зручності логів
  events.sort(function(a, b) { return a.getStartTime() - b.getStartTime(); });
  
  // Беремо всі дані одним масивом для швидкості
  const data = sheet.getRange(CONFIG.startRow, 1, CONFIG.endRow - CONFIG.startRow + 1, sheet.getLastColumn()).getValues();

  // --- ЕТАП 1: Парсимо всі події, відсіюємо невалідні ---
  // Ключ — номер квартири "045", значення — масив {event, eventDate, flatNumber}
  const flatEventsMap = {};

  events.forEach(event => {
    const eventTitle = event.getTitle();
    const description = event.getDescription();
    const eventDate = event.getStartTime();
    
    // Шукаємо значення поля "№ квартири" в описі події (HTML або текстовий формат)
    const fieldName = escapeRegex(CONFIG.checkFieldName);
    const regexHtml = new RegExp("<b>\\s*" + fieldName + "\\s*<\\/b>\\s*([^<\\n]+)");
    const regexText = new RegExp(fieldName + "\\s*:\\s*(.+?)(?:\\n|$)");
    const flatMatch = description.match(regexHtml) || description.match(regexText);

    if (!flatMatch) {
      console.log("Подія без поля '№ квартири': " + eventTitle + " від " + formatDateTime(eventDate));
      return;
    }

    // Обробляємо тільки події, назва яких починається з потрібного тексту
    if (!eventTitle.startsWith(CONFIG.eventTitle)) {
      console.log("Пропускаємо подію з невідповідною назвою: " + eventTitle + " від " + formatDateTime(eventDate));
      return;
    }

    const rawInput = flatMatch[1].trim();
    const flatNumber = parseInt(rawInput, 10);
    
    if (isNaN(flatNumber) || flatNumber < CONFIG.minFlat || flatNumber > CONFIG.maxFlat) {
      console.log("Невалідний номер квартири: '" + rawInput + "' — скасовуємо зустріч від " + formatDateTime(eventDate));
      sendCancellationEmail(event, rawInput, "Вказано невірний номер квартири.");
      event.deleteEvent();
      return;
    }

    // Парсимо контактні дані з опису
    const contact = parseContactInfo(description);

    console.log("Обробка події: " + eventTitle + " від " + formatDateTime(eventDate) + " — квартира № " + flatNumber);

    const bookedFlat = String(flatNumber).padStart(3, '0');
    
    if (!flatEventsMap[bookedFlat]) {
      flatEventsMap[bookedFlat] = [];
    }
    flatEventsMap[bookedFlat].push({ event: event, eventDate: eventDate, flatNumber: flatNumber, contact: contact });
  });

  // --- ЕТАП 2: Для кожної квартири залишаємо лише останній запис ---
  // Сортуємо квартири за найранішою датою запису для хронологічного порядку в логах
  const sortedFlats = Object.keys(flatEventsMap).sort(function(a, b) {
    const minA = flatEventsMap[a].reduce(function(min, b) { return b.eventDate < min ? b.eventDate : min; }, flatEventsMap[a][0].eventDate);
    const minB = flatEventsMap[b].reduce(function(min, b) { return b.eventDate < min ? b.eventDate : min; }, flatEventsMap[b][0].eventDate);
    return minA - minB;
  });

  // Збираємо підтверджені записи для вкладки "Черга"
  const confirmedBookings = [];

  for (let f = 0; f < sortedFlats.length; f++) {
    const bookedFlat = sortedFlats[f];
    const bookings = flatEventsMap[bookedFlat];
    
    // Сортуємо за датою (найпізніша подія першою)
    bookings.sort(function(a, b) { return b.eventDate - a.eventDate; });
    
    // Скасовуємо дублікати (всі крім останнього запису)
    for (let d = 1; d < bookings.length; d++) {
      const dup = bookings[d];
      console.log("Дублікат для квартири " + dup.flatNumber + " — скасовуємо старіший запис від " + formatDateTime(dup.eventDate));
      sendCancellationEmail(dup.event, dup.flatNumber, "Для вашої квартири є новіший запис на " + formatDateTime(bookings[0].eventDate));
      dup.event.deleteEvent();
    }
    
    // Обробляємо найновіший запис — перевіряємо борг
    const first = bookings[0];
    let flatFound = false;
    
    for (let i = 0; i < data.length; i++) {
      const flatInSheet = String(data[i][CONFIG.flatColumnStr - 1]).trim();
      const debt = data[i][CONFIG.debtColumn - 1];

      if (flatInSheet === bookedFlat) {
        flatFound = true;
        
        // Записуємо контактні дані в таблицю
        const c = first.contact;
        const row = i + CONFIG.startRow;
        if (c.name)  sheet.getRange(row, CONFIG.nameColumn).setValue(c.name);
        if (c.phone) sheet.getRange(row, CONFIG.phoneColumn).setValue(c.phone);
        if (c.email) sheet.getRange(row, CONFIG.emailColumn).setValue(c.email);

        if (debt > 0) {
          console.log("Видаляємо запис для квартири " + first.flatNumber + " на " + formatDateTime(first.eventDate) + " через борг: " + debt);
          
          sendCancellationEmail(first.event, first.flatNumber, 
            "Наявна заборгованість: " + debt + " грн. Будь ласка, погасіть борг та запишіться повторно.");
          
          first.event.deleteEvent();
          
          sheet.getRange(row, CONFIG.logColumn).setValue(
            "Запис на " + formatDateTime(first.eventDate) + " скасовано (борг: " + debt + ") — " + formatDateTime(new Date())
          );
        } else {
          console.log("Квартира " + first.flatNumber + " — борг відсутній, запис підтверджено на " + formatDateTime(first.eventDate));
          
          sheet.getRange(row, CONFIG.logColumn).setValue(
            "Запис на " + formatDateTime(first.eventDate) + " підтверджено — актуально на " + formatDateTime(new Date())
          );

          confirmedBookings.push({
            eventDate: first.eventDate,
            flatNumber: first.flatNumber,
            name: c.name,
            phone: c.phone,
            email: c.email
          });
        }
        break;
      }
    }
    
    if (!flatFound) {
      console.log("Квартиру " + first.flatNumber + " не знайдено в таблиці — скасовуємо зустріч від " + formatDateTime(first.eventDate));
      sendCancellationEmail(first.event, first.flatNumber, "Квартиру не знайдено в базі даних.");
      first.event.deleteEvent();
    }
  }

  // --- ЕТАП 3: Записуємо підтверджені записи у вкладку "Черга" ---
  writeQueue(confirmedBookings);
}

/**
 * Записує підтверджені записи у вкладку "Черга" у хронологічному порядку
 */
function writeQueue(confirmedBookings) {
  if (confirmedBookings.length === 0) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let queueSheet = ss.getSheetByName(CONFIG.queueSheetName);

  // Якщо аркуш не існує — створюємо з заголовками
  if (!queueSheet) {
    queueSheet = ss.insertSheet(CONFIG.queueSheetName);
    queueSheet.appendRow(["Дата запису", "№ квартири", "Ім'я", "Телефон", "Email", "Оновлено"]);
    queueSheet.getRange(1, 1, 1, 6).setFontWeight("bold");
  }

  // Сортуємо за датою (хронологічно)
  confirmedBookings.sort(function(a, b) { return a.eventDate - b.eventDate; });

  // Очищаємо старі дані (залишаємо заголовок)
  const lastRow = queueSheet.getLastRow();
  if (lastRow > 1) {
    queueSheet.getRange(2, 1, lastRow - 1, 6).clearContent();
  }

  // Записуємо нові дані
  var rows = confirmedBookings.map(function(b) {
    return [
      formatDateTime(b.eventDate),
      b.flatNumber,
      b.name,
      b.phone,
      b.email,
      formatDateTime(new Date())
    ];
  });

  queueSheet.getRange(2, 1, rows.length, 6).setValues(rows);
  console.log("Записано " + rows.length + " підтверджених записів у вкладку 'Черга'");
}

/**
 * Надсилає email про скасування запису
 */
function sendCancellationEmail(event, flatNumber, reason) {
  const email = getGuestEmail(event);
  if (!email) {
    console.log("Не вдалося отримати email для сповіщення");
    return;
  }
  
  try {
    MailApp.sendEmail({
      to: email,
      subject: "Ваш запис на огляд квартири на " + formatDateTime(event.getStartTime()) + " скасовано",
      htmlBody: "Доброго дня!<br><br>" +
        "Ваш запис на огляд квартири № <b>" + flatNumber + "</b> на <b>" + formatDateTime(event.getStartTime()) + "</b> скасовано.<br>" +
        "Причина: <b>" + reason + "</b><br><br>" +
        "З повагою,<br>ОК Синевир"
    });
  } catch (e) {
    console.log("Помилка надсилання email: " + e.message);
  }
}

/**
 * Форматує дату у зручний вигляд
 */
function formatDateTime(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm");
}

/**
 * Форматує дату у вигляді "dd.MM.yyyy"
 */
function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "dd.MM.yyyy");
}

/**
 * Парсить контактні дані з опису події
 * Формат: "<b>Призначає:</b> Ірина Тарновська irusia.tarnovska@gmail.com 0952589833 <br>"
 */
function parseContactInfo(description) {
  var result = { name: "", phone: "", email: "" };
  
  // Витягуємо вміст після першого <b>...</b> до першого <br>
  // Наприклад: "<b>Призначає:</b> Людмила Сергійчук sergijchyk@ukr.net 0672915061 <br>"
  var blockMatch = description.match(/<b>[^<]+<\/b>\s*([^<]+)\s*<br/i);
  if (!blockMatch) return result;
  
  var block = blockMatch[1].trim();
  
  // Знаходимо email
  var emailMatch = block.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  if (emailMatch) {
    result.email = emailMatch[0];
    block = block.replace(emailMatch[0], "").trim();
  }
  
  // Знаходимо телефон (українські формати: 0XX..., +380..., 380...)
  var phoneMatch = block.match(/(?:\+?3?8?)?0\d{9}/);
  if (phoneMatch) {
    result.phone = phoneMatch[0];
    block = block.replace(phoneMatch[0], "").trim();
  }
  
  // Все що залишилось — ім'я
  result.name = block.replace(/\s+/g, " ").trim();
  
  return result;
}

/**
 * Екранує спецсимволи для RegExp
 */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Отримує email першого гостя події
 */
function getGuestEmail(event) {
  try {
    const guests = event.getGuestList();
    if (guests && guests.length > 0) {
      return guests[0].getEmail();
    }
  } catch (e) {
    console.log("Помилка отримання email: " + e.message);
  }
  return null;
}


function syncRegistryToPublic() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const publicSheet = ss.getSheetByName(CONFIG.sheetName);
  const tz = Session.getScriptTimeZone();
  
  // Відкриваємо зовнішню таблицю Реєстру
  let registrySS, registrySheet, registryData;
  try {
    registrySS = SpreadsheetApp.openById(CONFIG.registrySpreadsheetId);
    registrySheet = registrySS.getSheetByName(CONFIG.registrySheetName);
    registryData = registrySheet.getDataRange().getValues();
  } catch (e) {
    console.log("Помилка доступу до Реєстру рішень: " + e.message);
    return;
  }

  const decisionsMap = {};
  const sheetId = registrySheet.getSheetId();

  // 1. Збираємо дані з Реєстру (виконані рішення)
  for (let i = 1; i < registryData.length; i++) {
    // Перевіряємо статус (Виконано)
    const status = String(registryData[i][CONFIG.registryStatusCol - 1]).trim();
    if (status !== "Виконано") continue;

    const rawNum = String(registryData[i][CONFIG.registryNumCol - 1]).trim();
    const rawApts = String(registryData[i][CONFIG.registryAptCol - 1]);
    const rawDate = registryData[i][CONFIG.registryDateCol - 1];
    const date = rawDate instanceof Date ? formatDate(rawDate) : String(rawDate);
    const desc = String(registryData[i][CONFIG.registryDescCol - 1]).substring(0, 30);
    const rowLink = "https://docs.google.com/spreadsheets/d/" + CONFIG.registrySpreadsheetId + "/edit#gid=" + sheetId + "&range=" + (i + 1) + ":" + (i + 1);

    // Парсимо номери квартир
    var aptNumbers = parseAptList(rawApts);

    aptNumbers.forEach(function(num) {
      if (num < CONFIG.minFlat || num > CONFIG.maxFlat) return;
      // Зберігаємо рішення під ЧИСЛОВИМ ключем (напр. 45, а не "045")
      if (!decisionsMap[num]) decisionsMap[num] = [];
      decisionsMap[num].push({ text: "Рішення №" + rawNum + " (" + date + "): " + desc, link: rowLink });
    });
  }

  // 2. Оновлюємо стовпчик "Прийняті рішення" у публічній таблиці
  const publicData = publicSheet.getRange(CONFIG.startRow, 1, CONFIG.endRow - CONFIG.startRow + 1, publicSheet.getLastColumn()).getValues();

  for (let j = 0; j < publicData.length; j++) {
    const aptNum = parseInt(publicData[j][CONFIG.flatColumnNum - 1], 10); 
    const range = publicSheet.getRange(j + CONFIG.startRow, CONFIG.decisionsCol);

    if (isNaN(aptNum) || !decisionsMap[aptNum]) {
      range.clearContent();
      continue;
    }

    // Формуємо RichText з гіперпосиланнями
    var builder = SpreadsheetApp.newRichTextValue();
    var fullText = "";
    var links = [];

    decisionsMap[aptNum].forEach(function(d, idx) {
      var separator = idx === 0 ? "" : " | ";
      var start = fullText.length + separator.length;
      fullText += separator + d.text;
      links.push({ start: start, end: fullText.length, url: d.link });
    });

    builder.setText(fullText);
    links.forEach(function(l) { builder.setLinkUrl(l.start, l.end, l.url); });
    range.setRichTextValue(builder.build());
  }

  console.log("syncRegistryToPublic: оновлено " + Object.keys(decisionsMap).length + " квартир з рішеннями");
}

/**
 * Парсить рядок номерів квартир: "1, 2, 3" або "1-5" або "1, 3-5, 8"
 * Повертає масив чисел
 */
function parseAptList(raw) {
  var result = [];
  var parts = String(raw).split(/[,;]+/);
  
  parts.forEach(function(part) {
    part = part.trim();
    var rangeMatch = part.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (rangeMatch) {
      var from = parseInt(rangeMatch[1], 10);
      var to = parseInt(rangeMatch[2], 10);
      for (var n = from; n <= to; n++) {
        result.push(n);
      }
    } else {
      var num = parseInt(part, 10);
      if (!isNaN(num)) result.push(num);
    }
  });
  
  return result;
}