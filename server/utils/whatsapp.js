// WhatsApp delivery through a self-hosted Blastup gateway (Baileys). See deploy/whatsapp/README.md.
//
// Every employee links their OWN phone. The gateway holds one account per TaskManager user (created on
// demand, never seen by anyone), and an alert goes out from the phone of whoever caused it.
// The company number is optional, for alerts that have no linked sender (reminders, or an actor who has
// not linked yet): WHATSAPP_COMPANY_EMAIL names a TaskManager user whose linked phone plays that part, or
// BLASTUP_API_KEY is a raw gateway key. Without BLASTUP_URL every send is a silent no-op.
const crypto = require("crypto");
const User = require("../model/user.model.js");

const BASE = (process.env.BLASTUP_URL || "").replace(/\/$/, "");
const COMPANY_KEY = process.env.BLASTUP_API_KEY || "";
const COMPANY_EMAIL = (process.env.WHATSAPP_COMPANY_EMAIL || "").trim().toLowerCase();
const whatsappEnabled = Boolean(BASE);

// Blastup rejects the whole request past 4096 characters, so truncate rather than lose the alert.
const MAX_TEXT = 4096;

// Gateway API keys are stored encrypted, and the gateway passwords are derived rather than stored, both
// from WHATSAPP_SECRET. Changing it orphans the gateway accounts: everyone links again.
const SECRET = process.env.WHATSAPP_SECRET || process.env.JWT_SECRET || "";
const boxKey = crypto.createHash("sha256").update(`wa-box:${SECRET}`).digest();

const seal = (text) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", boxKey, iv);
    const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
};

const open = (sealed) => {
    try {
        const [iv, tag, data] = String(sealed).split(".").map((s) => Buffer.from(s, "base64"));
        const decipher = crypto.createDecipheriv("aes-256-gcm", boxKey, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
        return null;
    }
};

/** One call to the gateway. Never throws on an HTTP error; a dead gateway rejects (caller decides). */
const gateway = async (path, { method = "GET", key, cookie, body } = {}) => {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (key) headers["x-api-key"] = key;
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${BASE}${path}`, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
        // A pairing code waits for WhatsApp; everything else is quick. A wedged socket must not hang us.
        signal: AbortSignal.timeout(45000),
    });
    const json = await response.json().catch(() => ({}));
    const setCookie = (response.headers.getSetCookie?.() || []).join(";");
    return {
        status: response.status,
        ok: response.ok,
        data: json.data ?? json,
        error: json.error || json.message || `gateway returned ${response.status}`,
        cookie: (setCookie.match(/wa_token=[^;]+/) || [])[0],
    };
};

/**
 * The gateway API key for this user's own WhatsApp, creating their gateway account the first time.
 * The account name and password are derived from the user id, so a lost key is recoverable by logging in.
 */
const accountKey = async (userId) => {
    const user = await User.findById(userId).select("+waKey");
    if (!user) throw new Error("No such user");
    const existing = user.waKey && open(user.waKey);
    if (existing) return existing;

    const id = String(user._id);
    const email = `tm-${id}@taskmanager.local`;
    const password = crypto.createHmac("sha256", boxKey).update(`pw:${id}`).digest("hex");
    let session = await gateway("/api/auth/register", { method: "POST", body: { email, phone: `tm${id.slice(-16)}`, password } });
    if (session.status === 409) session = await gateway("/api/auth/login", { method: "POST", body: { username: email, password } });
    if (!session.ok || !session.cookie) throw new Error(`WhatsApp gateway account: ${session.error}`);

    const created = await gateway("/api/keys", { method: "POST", cookie: session.cookie, body: { name: "taskmanager" } });
    if (!created.ok || !created.data?.key) throw new Error(`WhatsApp gateway key: ${created.error}`);
    await User.updateOne({ _id: user._id }, { $set: { waKey: seal(created.data.key) } });
    return created.data.key;
};

/** The sender's key, or null when they have never started linking. Does not create accounts. */
const existingKey = async (userId) => {
    const user = await User.findById(userId).select("+waKey").lean();
    return (user?.waKey && open(user.waKey)) || null;
};

const companyKey = async () => {
    if (COMPANY_KEY) return COMPANY_KEY;
    const company = COMPANY_EMAIL && await User.findOne({ email: COMPANY_EMAIL }).select("_id").lean();
    return company ? existingKey(company._id) : null;
};

/**
 * Sends one WhatsApp message from `from` (a user id) or, with no sender, from the company number.
 * Returns "sent", "not-linked" (the sender's phone is not connected - the caller may fall back) or
 * "failed". Never throws: the in-app alert has already landed by the time we get here.
 */
const sendWhatsApp = async ({ to, text, from }) => {
    if (!whatsappEnabled || !to || !text) return "failed";
    try {
        const key = from ? await existingKey(from) : await companyKey();
        if (!key) return "not-linked";
        const result = await gateway("/api/send/text", { method: "POST", key, body: { to, text: text.slice(0, MAX_TEXT) } });
        if (result.ok) return "sent";
        // 503 is the gateway's "WhatsApp is not connected for this account".
        if (from && result.status === 503) {
            await User.updateOne({ _id: from }, { $set: { waPhone: null } });
            return "not-linked";
        }
        console.error(`WhatsApp send failed (${result.status}):`, String(result.error).slice(0, 300));
        return "failed";
    } catch (error) {
        console.error("WhatsApp send failed:", error.message);
        return "failed";
    }
};

const companyNumber = Boolean(COMPANY_KEY || COMPANY_EMAIL);

module.exports = { whatsappEnabled, companyNumber, gateway, accountKey, existingKey, sendWhatsApp };
