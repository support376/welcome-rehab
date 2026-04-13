/**
 * 웰컴회생 · Google Apps Script 웹앱
 *
 * 1) 이 파일 전체를 script.google.com 새 프로젝트에 붙여넣고
 * 2) 아래 SHEET_ID / CALENDAR_ID 를 본인 값으로 수정
 * 3) "배포" → "웹 앱으로 배포"
 *    - 실행 계정: "나"
 *    - 액세스 권한: "모든 사용자" (Vercel 서버리스가 호출할 수 있도록)
 * 4) 생성된 URL 을 Vercel 환경변수 GAS_WEBHOOK_URL 에 등록
 */

// ===================== 설정 =====================
const SHEET_ID = 'PUT_YOUR_SHEET_ID_HERE';       // Google Sheet URL 의 /d/ 와 /edit 사이 문자열
const CALENDAR_ID = 'primary';                    // 'primary' = 기본 캘린더, 또는 공유 캘린더 이메일

// 상담 운영 시간 (24시간제)
const OPEN_HOUR = 10;    // 10:00 부터
const CLOSE_HOUR = 21;   // 마지막 슬롯 시작 = 20:00 (20:00 ~ 21:00)
const SLOT_HOURS = 1;    // 슬롯 길이
const DAYS_AHEAD = 7;    // 앞으로 7일치 노출
const MIN_LEAD_HOURS = 2;// 최소 2시간 전까지만 예약 가능
// ===============================================


function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  try {
    if (action === 'slots') return json(getSlots());
    if (action === 'ping')  return json({ ok: true });
    return json({ error: 'unknown action', action });
  } catch (err) {
    return json({ error: err.message, stack: err.stack });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action || '';
    if (action === 'lead') return json(saveLead(body));
    if (action === 'book') return json(bookSlot(body));
    return json({ error: 'unknown action', action });
  } catch (err) {
    return json({ error: err.message, stack: err.stack });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ---------- Slots ---------- */

function getSlots() {
  const cal = getCalendar();
  const now = new Date();
  const minLead = new Date(now.getTime() + MIN_LEAD_HOURS * 3600 * 1000);
  const slots = [];

  for (let d = 0; d <= DAYS_AHEAD; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    day.setHours(0, 0, 0, 0);

    for (let h = OPEN_HOUR; h < CLOSE_HOUR; h += SLOT_HOURS) {
      const start = new Date(day);
      start.setHours(h, 0, 0, 0);
      const end = new Date(day);
      end.setHours(h + SLOT_HOURS, 0, 0, 0);

      if (start < minLead) continue;

      const conflicts = cal.getEvents(start, end);
      if (conflicts.length === 0) {
        slots.push({
          start: start.toISOString(),
          end: end.toISOString(),
          label: formatSlot(start),
        });
      }
    }
  }
  return { ok: true, slots };
}

function formatSlot(d) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const mm = (d.getMonth() + 1);
  const dd = d.getDate();
  const dow = days[d.getDay()];
  const hh = d.getHours();
  const ampm = hh < 12 ? '오전' : '오후';
  const h12 = hh <= 12 ? hh : hh - 12;
  return `${mm}/${dd}(${dow}) ${ampm} ${h12}시`;
}


/* ---------- Lead ---------- */

function saveLead(body) {
  const sheet = getLeadSheet();
  const contact = body.contact || {};
  const summary = body.summary || {};
  const row = [
    new Date(),
    contact.name || '',
    contact.phone || '',
    contact.consent ? '동의' : '',
    summary.case_classification || '',
    summary.urgency || '',
    summary.classification_reason || '',
    JSON.stringify(summary),
  ];
  sheet.appendRow(row);
  return { ok: true };
}

function getLeadSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('leads');
  if (!sheet) {
    sheet = ss.insertSheet('leads');
    sheet.appendRow([
      '타임스탬프', '이름', '휴대폰', '동의',
      '분류', '긴급도', '분류 사유', '전체 요약(JSON)',
    ]);
  }
  return sheet;
}


/* ---------- Booking ---------- */

function bookSlot(body) {
  const cal = getCalendar();
  const start = new Date(body.start);
  const end = new Date(body.end);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { ok: false, error: 'invalid datetime' };
  }

  // 재확인 (경쟁 상태 방지)
  const conflicts = cal.getEvents(start, end);
  if (conflicts.length > 0) {
    return { ok: false, error: 'already booked', conflict: true };
  }

  const contact = body.contact || {};
  const summary = body.summary || {};
  const title = `[웰컴회생 상담] ${contact.name || '익명'} · ${contact.phone || ''}`;
  const desc = [
    '분류: ' + (summary.case_classification || ''),
    '긴급도: ' + (summary.urgency || ''),
    '사유: ' + (summary.classification_reason || ''),
    '',
    '전체 요약:',
    JSON.stringify(summary, null, 2),
  ].join('\n');

  cal.createEvent(title, start, end, { description: desc });

  // 예약 로그도 시트에 추가
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let bs = ss.getSheetByName('bookings');
    if (!bs) {
      bs = ss.insertSheet('bookings');
      bs.appendRow(['예약시각', '시작', '종료', '이름', '휴대폰', '분류']);
    }
    bs.appendRow([
      new Date(), start, end,
      contact.name || '', contact.phone || '',
      summary.case_classification || '',
    ]);
  } catch (e) { /* ignore sheet errors */ }

  return { ok: true, label: formatSlot(start) };
}

function getCalendar() {
  if (CALENDAR_ID === 'primary') return CalendarApp.getDefaultCalendar();
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) throw new Error('Calendar not found: ' + CALENDAR_ID);
  return cal;
}
