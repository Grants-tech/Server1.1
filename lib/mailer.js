/**
 * lib/mailer.js
 *
 * Sends signal-alert emails over plain SMTP via nodemailer. Works with
 * any SMTP provider — Gmail (with an App Password), SendGrid, Mailgun,
 * Postmark, Resend, your own mail server, etc. — so you're not locked
 * into a specific vendor. Configure via env vars (see .env.example).
 */

const nodemailer = require('nodemailer');

function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS missing).');
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: SMTP_SECURE === 'true', // true for port 465, false for 587/STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
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
  const to = process.env.EMAIL_TO;
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  if (!to) {
    throw new Error('EMAIL_TO is not set — nowhere to send the alert.');
  }

  const transport = getTransport();
  const { subject, text, html } = formatSignalEmail(result);

  await transport.sendMail({ from, to, subject, text, html });
}

module.exports = { sendSignalEmail, formatSignalEmail };
