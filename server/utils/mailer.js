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

const sendMail = async ({ to, subject, text, html }) => {
    if (!transporter || !to) return false;
    try {
        await transporter.sendMail({
            from: MAIL_FROM || SMTP_USER,
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
