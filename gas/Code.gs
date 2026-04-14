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
const SHEET_ID = '1i-Mtl3GNZ-aNTM7I6JzSgjMGZFsg13godJGzXvEgqhs';
const CALENDAR_ID = 'primary';                    // 'primary' = 기본 캘린더, 또는 공유 캘린더 이메일

// 상담 운영 시간 (24시간제)
const OPEN_HOUR = 10;    // 10:00 부터
const CLOSE_HOUR = 21;   // 마지막 슬롯 시작 = 20:00 (20:00 ~ 21:00)
const SLOT_HOURS = 1;    // 슬롯 길이
const DAYS_AHEAD = 7;    // 앞으로 7일치 노출 (1주)
const MIN_LEAD_HOURS = 2;// 최소 2시간 전까지만 예약 가능

// HOT 케이스 긴급 알림 수신자 (변호사 이메일)
const HOT_ALERT_EMAIL = 'hsyang@welcomelaw.co.kr';
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
  const booking = summary.booking_request || {};
  const row = [
    new Date(),
    contact.name || '',
    contact.phone || '',
    contact.consent ? '동의' : '',
    summary.case_classification || '',
    summary.urgency || '',
    summary.classification_reason || '',
    booking.desired_date || '',
    booking.desired_time_slot || '',
    JSON.stringify(summary),
  ];
  sheet.appendRow(row);
  maybeSendHotAlert('lead', contact, summary, null);
  return { ok: true };
}

function isHotCase(summary) {
  if (!summary) return false;
  const c = (summary.case_classification || '').toUpperCase();
  const u = (summary.urgency || '').toLowerCase();
  if (c === 'HOT') return true;
  if (u === 'high') return true;
  // STEP 1 결과에 is_hot === true 인 경우도 긴급 처리
  if (summary.estimate && summary.estimate.is_hot === true) return true;
  if (summary.inputs && (summary.inputs.delinquency === 'lawsuit' || summary.inputs.delinquency === 'court')) return true;
  return false;
}

function maybeSendHotAlert(kind, contact, summary, booking) {
  try {
    if (!isHotCase(summary)) return;
    if (!HOT_ALERT_EMAIL) return;

    const subject = '[웰컴회생 긴급] ' + (contact.name || '익명') + ' · ' + (summary.case_classification || 'HOT');
    const lines = [
      '🚨 긴급 HOT 케이스가 접수되었습니다.',
      '',
      '■ 접수 유형: ' + (kind === 'book' ? '상담 예약까지 완료' : '연락처 제출(예약 미완료)'),
      '■ 이름: ' + (contact.name || '-'),
      '■ 휴대폰: ' + (contact.phone || '-'),
      '■ 분류: ' + (summary.case_classification || '-'),
      '■ 긴급도: ' + (summary.urgency || '-'),
      '■ 사유: ' + (summary.classification_reason || '-'),
    ];
    if (booking) {
      lines.push('');
      lines.push('■ 예약 일시: ' + (booking.label || booking.start));
    }
    if (summary.inputs) {
      lines.push('');
      lines.push('■ STEP 1 입력값:');
      lines.push(JSON.stringify(summary.inputs, null, 2));
    }
    if (summary.estimate) {
      lines.push('');
      lines.push('■ 1차 추정:');
      lines.push(JSON.stringify(summary.estimate, null, 2));
    }
    lines.push('');
    lines.push('■ 전체 요약:');
    lines.push(JSON.stringify(summary, null, 2));

    MailApp.sendEmail({
      to: HOT_ALERT_EMAIL,
      subject: subject,
      body: lines.join('\n'),
    });
  } catch (e) {
    // 메일 실패는 전체 플로우 막지 않음
    console.error('hot alert failed:', e.message);
  }
}

function getLeadSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('leads');
  if (!sheet) {
    sheet = ss.insertSheet('leads');
    sheet.appendRow([
      '타임스탬프', '이름', '휴대폰', '동의',
      '분류', '긴급도', '분류 사유',
      '희망일자', '희망시간대',
      '전체 요약(JSON)',
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

  maybeSendHotAlert('book', contact, summary, { start: start, end: end, label: formatSlot(start) });
  return { ok: true, label: formatSlot(start) };
}

function getCalendar() {
  if (CALENDAR_ID === 'primary') return CalendarApp.getDefaultCalendar();
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) throw new Error('Calendar not found: ' + CALENDAR_ID);
  return cal;
}
