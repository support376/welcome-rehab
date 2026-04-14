const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1i-Mtl3GNZ-aNTM7I6JzSgjMGZFsg13godJGzXvEgqhs/edit';
const LEAD_RECIPIENTS = ['koreavisa@well-come.biz', 'hsyang@welcomelaw.co.kr'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const url = process.env.GAS_WEBHOOK_URL;
  if (!url) {
    return res.status(500).json({ error: 'GAS_WEBHOOK_URL not configured' });
  }
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'lead', ...(req.body || {}) }),
      redirect: 'follow',
    });
    const data = await upstream.json().catch(() => ({}));

    sendLeadEmail(req.body || {}).catch((err) => {
      console.error('resend email failed:', err?.message || err);
    });

    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'Upstream error: ' + e.message });
  }
}

async function sendLeadEmail(body) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const from = `웰컴회생 <${fromEmail}>`;
  const contact = body.contact || {};
  const summary = body.summary || {};
  const booking = summary.booking_request || {};

  const name = contact.name || '익명';
  const cls = summary.case_classification || '미분류';
  const urgency = summary.urgency || '-';
  const isHot = urgency === 'high' || cls.toUpperCase() === 'HOT';

  const subject = `[웰컴회생 접수] ${name} · ${cls}${isHot ? ' · 🚨긴급' : ''}`;

  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  const html = `
<div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:640px;line-height:1.6;color:#111">
  <h2 style="margin:0 0 12px">웰컴회생 홈페이지 새 접수</h2>
  <p style="margin:0 0 20px;color:#555">${now}</p>

  <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
    <tr><td style="padding:6px 0;color:#666;width:120px">이름</td><td><b>${escapeHtml(name)}</b></td></tr>
    <tr><td style="padding:6px 0;color:#666">휴대폰</td><td><b>${escapeHtml(contact.phone || '-')}</b></td></tr>
    <tr><td style="padding:6px 0;color:#666">개인정보 동의</td><td>${contact.consent ? 'O' : 'X'}</td></tr>
    <tr><td style="padding:6px 0;color:#666">희망 일자</td><td>${escapeHtml(booking.desired_date || '-')}</td></tr>
    <tr><td style="padding:6px 0;color:#666">희망 시간대</td><td>${escapeHtml(booking.desired_time_slot || '-')}</td></tr>
    <tr><td style="padding:6px 0;color:#666">케이스 분류</td><td>${escapeHtml(cls)}</td></tr>
    <tr><td style="padding:6px 0;color:#666">긴급도</td><td>${escapeHtml(urgency)}</td></tr>
    <tr><td style="padding:6px 0;color:#666;vertical-align:top">분류 사유</td><td>${escapeHtml(summary.classification_reason || '-')}</td></tr>
  </table>

  <p style="margin:20px 0">
    <a href="${SHEET_URL}" style="display:inline-block;padding:10px 18px;background:#6529FF;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">
      📊 연결된 구글시트 열기
    </a>
  </p>

  <details style="margin-top:24px">
    <summary style="cursor:pointer;color:#666">전체 요약 JSON</summary>
    <pre style="background:#f6f6f8;padding:12px;border-radius:6px;font-size:12px;overflow:auto">${escapeHtml(JSON.stringify(summary, null, 2))}</pre>
  </details>

  <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
  <p style="color:#999;font-size:12px;margin:0">이 메일은 welcome-rehab.vercel.app 접수 시 자동 발송됩니다.</p>
</div>`.trim();

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: LEAD_RECIPIENTS,
      subject,
      html,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Resend ${resp.status}: ${text}`);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
