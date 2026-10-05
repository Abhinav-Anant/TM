const mongoose = require('mongoose');
const User = require('../model/user.model.js');
const { whatsappEnabled, companyNumber, gateway, accountKey, existingKey } = require('../utils/whatsapp.js');
const { normalizePhone } = require('../utils/phone.js');
const { departmentMemberIds } = require('../utils/scope.js');
const { enqueue } = require('../utils/jobs.js');

const MAX_TEXT = 2000;

const unavailable = (res) => res.status(503).json({ message: "WhatsApp is not set up on this server." });

/** The gateway's view of one user's link, mirrored into waPhone so alerts know who can send. */
const linkState = async (userId, key) => {
    const status = await gateway("/api/whatsapp/status", { key });
    if (!status.ok) throw new Error(status.error);
    const state = status.data?.status || "disconnected";
    const phone = state === "connected" ? status.data.phone || null : null;
    await User.updateOne({ _id: userId }, { $set: { waPhone: phone } });
    let qr = null;
    if (state === "qr_ready") {
        const code = await gateway("/api/whatsapp/qr", { key });
        qr = code.ok ? code.data?.qr || null : null;
    }
    return { status: state, phone, qr };
};

const fail = (res, error) => {
    console.error("WhatsApp link:", error.message);
    res.status(502).json({ message: "The WhatsApp gateway did not answer. Try again in a minute." });
};

// GET /api/whatsapp/me
const getMyLink = async (req, res) => {
    if (!whatsappEnabled) return res.json({ enabled: false });
    try {
        const key = await existingKey(req.user._id);
        const state = key ? await linkState(req.user._id, key) : { status: "disconnected", phone: null, qr: null };
        res.json({ enabled: true, companyNumber, ...state });
    } catch (error) {
        fail(res, error);
    }
};

// POST /api/whatsapp/me/link - start a session; the QR shows up on the next GET /me.
const startLink = async (req, res) => {
    if (!whatsappEnabled) return unavailable(res);
    try {
        const key = await accountKey(req.user._id);
        const started = await gateway("/api/whatsapp/reconnect", { method: "POST", key });
        if (!started.ok) throw new Error(started.error);
        res.json({ status: "connecting" });
    } catch (error) {
        fail(res, error);
    }
};

// POST /api/whatsapp/me/pair { phone } - for linking on the phone itself, where a QR cannot be scanned.
const pairWithCode = async (req, res) => {
    if (!whatsappEnabled) return unavailable(res);
    const phone = normalizePhone(req.body?.phone || req.user.phone);
    if (!phone) return res.status(400).json({ message: "Enter the WhatsApp number on this phone, with country code." });
    try {
        const key = await accountKey(req.user._id);
        const paired = await gateway("/api/whatsapp/pair", { method: "POST", key, body: { phone } });
        if (paired.status === 409) return res.status(409).json({ message: "This account is already linked." });
        if (!paired.ok || !paired.data?.code) throw new Error(paired.error);
        res.json({ code: paired.data.code, phone });
    } catch (error) {
        fail(res, error);
    }
};

// POST /api/whatsapp/me/unlink
const unlink = async (req, res) => {
    if (!whatsappEnabled) return unavailable(res);
    try {
        const key = await existingKey(req.user._id);
        if (key) {
            const out = await gateway("/api/whatsapp/logout", { method: "POST", key });
            if (!out.ok) throw new Error(out.error);
        }
        await User.updateOne({ _id: req.user._id }, { $set: { waPhone: null } });
        res.json({ status: "disconnected" });
    } catch (error) {
        fail(res, error);
    }
};

// GET /api/whatsapp/accounts (admin) - who has linked their phone. Refreshed from the gateway each time.
const listAccounts = async (req, res) => {
    const users = await User.find().select("+waKey name email role phone waPhone memberships").sort({ name: 1 }).lean();
    if (whatsappEnabled) {
        await Promise.all(users.filter((u) => u.waKey).map(async (u) => {
            const key = await existingKey(u._id);
            if (!key) return;
            try { u.waPhone = (await linkState(u._id, key)).phone; } catch { /* gateway down: keep the cached value */ }
        }));
    }
    res.json({
        enabled: whatsappEnabled,
        companyNumber,
        users: users.map(({ _id, name, email, role, phone, waPhone }) => ({ _id, name, email, role, phone, linkedAs: waPhone })),
    });
};

// POST /api/whatsapp/send (admin) { text, userIds?: [], departmentId?: id, everyone?: bool }
// Goes from the admin's own phone when linked, otherwise from the company number.
const sendMessage = async (req, res) => {
    if (!whatsappEnabled) return unavailable(res);
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ message: "Write a message first." });
    if (text.length > MAX_TEXT) return res.status(400).json({ message: `Keep it under ${MAX_TEXT} characters.` });

    const { userIds, departmentId, everyone } = req.body || {};
    let filter;
    if (everyone === true) filter = {};
    else if (departmentId && mongoose.isValidObjectId(departmentId)) filter = { _id: { $in: await departmentMemberIds([departmentId]) } };
    else if (Array.isArray(userIds) && userIds.length) filter = { _id: { $in: userIds.map(String).filter((id) => mongoose.isValidObjectId(id)) } };
    else return res.status(400).json({ message: "Pick who gets the message." });

    const me = await User.findById(req.user._id).select("name waPhone").lean();
    const from = me.waPhone ? String(me._id) : null;
    if (!from && !companyNumber) {
        return res.status(409).json({ message: "Link your WhatsApp on your profile first." });
    }

    const recipients = await User.find({ ...filter, _id: { ...(filter._id || {}), $ne: me._id } }).select("name phone").lean();
    const reachable = recipients.filter((u) => u.phone);
    // From the company number the message has to say who wrote it; from the admin's phone it already does.
    const body = from ? text : `*${me.name}:*\n${text}`;
    await Promise.all(reachable.map((u) => enqueue("whatsapp", { to: u.phone, from, text: body })));

    res.json({
        queued: reachable.length,
        noNumber: recipients.filter((u) => !u.phone).map((u) => u.name),
        from: from ? "your WhatsApp" : "the company number",
    });
};

module.exports = { getMyLink, startLink, pairWithCode, unlink, listAccounts, sendMessage };
