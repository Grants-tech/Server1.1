/**
 * lib/mailer.js
 *
 * Sends signal-alert emails via the Resend HTTP API (https://resend.com).
 *
 * Why HTTP instead of SMTP: Railway blocks outbound SMTP ports (587/465)
 * by default as an anti-spam measure, so nodemailer-over-SMTP hangs and
 * times out no matter which provider (Gmail, Zoho, etc.) you point it at.
 * Resend's API travels over plain HTTPS (port 443), which is never
 * blocked, so it works reliably from Railway.
 *
 * Setup:
 *  1. Sign up free at https://resend.com (no card required)
 *  2. Copy your API key -> set as RESEND_API_KEY
 *  3. Quick start: leave EMAIL_FROM unset (defaults to Resend's sandbox
 *     sender, onboarding@resend.dev) — but this can only deliver to the
 *     email address you signed up to Resend with.
 *  4. For real use: verify your own domain in Resend (Domains -> Add
 *     Domain -> add the DNS records it gives you to your domain's DNS,
 *     e.g. in Zoho DNS if that's where your domain is hosted), then set
 *     EMAIL_FROM=alerts@yourdomain.com — this removes the "only your own
 *     inbox" restriction and lets you send to any address.
 */

const axios = require('axios');

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'XAUUSD TA System <onboarding@resend.dev>';

async function sendEmail({ subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.EMAIL_TO;
  const from = process.env.EMAIL_FROM || DEFAULT_FROM;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set.');
  }
  if (!to) {
    throw new Error('EMAIL_TO is not set — nowhere to send the email.');
  }

  try {
    await axios.post(
      RESEND_API_URL,
      { from, to: [to], subject, text, html },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
  } catch (err) {
    const apiMessage = err.response?.data?.message;
    throw new Error(apiMessage ? `Resend API error: ${apiMessage}` : err.message);
  }
}

function formatSignalEmail(result) {
  const ts = result.tradeSetup;
  const dirLabel = ts.direction === 'long' ? 'LONG' : 'SHORT';
  const emoji = ts.direction === 'long' ? '🟢' : '🔴';
  const subject = `${emoji} High-Confidence XAUUSD ${dirLabel} Signal — score ${result.weightedScore}`;

  const tpLines = ts.takeProfits.map((tp, i) => `TP${i + 1}: ${tp}`).join('\n');

  const text = [
    `XAU/USD ${dirLabel} — high-confidence intraday signal`,
    `Generated: ${result.generatedAt}`,
    `Price: ${result.price}`,
    `Weighted score: ${result.weightedScore} (${result.overallSignal})`,
    '',
    `Entry: ${ts.entryZone.label}`,
    `SL: ${ts.stopLoss}`,
    tpLines,
    `TP: Open (trail remainder)`,
    '',
    'Why:',
    ...result.notes.map((n) => `- ${n}`),
    '',
    result.disclaimer,
  ].join('\n');

  const html = `
    <h2>${emoji} XAU/USD ${dirLabel} — high-confidence intraday signal</h2>
    <p><b>Generated:</b> ${result.generatedAt}<br/>
       <b>Price:</b> ${result.price}<br/>
       <b>Weighted score:</b> ${result.weightedScore} (${result.overallSignal})</p>
    <table cellpadding="4" style="border-collapse:collapse">
      <tr><td><b>Entry</b></td><td>${ts.entryZone.label}</td></tr>
      <tr><td><b>SL</b></td><td>${ts.stopLoss}</td></tr>
      ${ts.takeProfits.map((tp, i) => `<tr><td><b>TP${i + 1}</b></td><td>${tp}</td></tr>`).join('')}
      <tr><td><b>TP: Open</b></td><td>trail remainder</td></tr>
    </table>
    <p><b>Why:</b></p>
    <ul>${result.notes.map((n) => `<li>${n}</li>`).join('')}</ul>
    <p style="color:#888;font-size:12px">${result.disclaimer}</p>
  `;

  return { subject, text, html };
}

async function sendSignalEmail(result) {
  const { subject, text, html } = formatSignalEmail(result);
  await sendEmail({ subject, text, html });
}

/**
 * Sends a plain test email, bypassing the confidence gate entirely.
 * Used only to verify Resend/API-key/delivery are working — not part of
 * the normal analysis cycle.
 */
async function sendTestEmail() {
  await sendEmail({
    subject: '✅ XAUUSD TA System — test email',
    text: [
      'This is a test email from your XAUUSD technical analysis server.',
      '',
      'If you received this, your email configuration is working correctly',
      'and you will receive real alerts (max 2/day) when a high-confidence',
      'signal is detected.',
      '',
      `Sent at: ${new Date().toISOString()}`,
    ].join('\n'),
  });
}

module.exports = { sendSignalEmail, sendTestEmail, formatSignalEmail };
