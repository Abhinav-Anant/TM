// Email over plain SMTP (nodemailer). Opt-in like WhatsApp: without SMTP_HOST and SMTP_FROM nothing is
// sent and nothing breaks. Works with any provider that speaks SMTP (Mailgun, SES, Resend's SMTP, a mail server).
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, SMTP_SECURE=true (port 465), SMTP_FROM
const nodemailer = require('nodemailer');

const emailEnabled = Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);

let transport = null;
const getTransport = () => {
    if (!transport) {
        transport = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
            connectionTimeout: 10000,
            socketTimeout: 15000,
        });
    }
    return transport;
};

/**
 * Sends one plain-text email. THROWS on failure: the caller is a queue job, and the queue
 * retries with backoff. Returns false only when email is not configured.
 */
const sendEmail = async ({ to, subject, text }) => {
    if (!emailEnabled || !to || !subject) return false;
    await getTransport().sendMail({ from: process.env.SMTP_FROM, to, subject, text });
    return true;
};

module.exports = { sendEmail, emailEnabled };
