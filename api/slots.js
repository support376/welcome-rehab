export default async function handler(req, res) {
  const url = process.env.GAS_WEBHOOK_URL;
  if (!url) {
    return res.status(500).json({ error: 'GAS_WEBHOOK_URL not configured' });
  }
  try {
    const upstream = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=slots', {
      method: 'GET',
      redirect: 'follow',
    });
    const data = await upstream.json().catch(() => ({}));
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'Upstream error: ' + e.message });
  }
}
