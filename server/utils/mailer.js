const nodemailer = require('nodemailer');

// Email is opt-in: without SMTP env vars every send is a silent no-op so the app still runs.
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

const transporter = SMTP_HOST && SMTP_USER
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT) || 587,
        secure: Number(SMTP_PORT) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
    : null;

const mailEnabled = Boolean(transporter);

const escapeHtml = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

/**
 * `fromName` / `replyTo` let an alert read as coming from the person who caused it
 * (the admin or head who assigned, the member who started) while the envelope stays
 * on our own domain - so SPF/DKIM still pass and replies reach a real human.
 * The object form of `from` is deliberate: nodemailer MIME-encodes the display name,
 * which a hand-built `"name" <addr>` string would not, leaving a header-injection hole.
 */
const sendMail = async ({ to, subject, text, html, fromName, replyTo }) => {
    if (!transporter || !to) return false;
    const address = MAIL_FROM || SMTP_USER;
    try {
        await transporter.sendMail({
            from: fromName ? { name: fromName, address } : address,
            replyTo,
            to,
            subject,
            text,
            html,
        });
        return true;
    } catch (error) {
        console.error("Email send failed:", error.message);
        return false;
    }
};

module.exports = { sendMail, mailEnabled, escapeHtml };
