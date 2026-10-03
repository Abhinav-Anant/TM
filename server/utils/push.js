// Mobile push through Expo's push service (works for the Expo mobile app; no SDK needed, one HTTPS call).
// EXPO_PUSH_URL can point at a fake in tests. EXPO_ACCESS_TOKEN is optional (only if you enabled enhanced security).
const User = require('../model/user.model.js');

const EXPO_PUSH_URL = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
const TOKEN_RE = /^(Expo|Exponent)PushToken\[[^\]]+\]$/;

const isExpoToken = (token) => TOKEN_RE.test(String(token || ''));

/**
 * Sends one notification to every device token of a user. Throws if Expo is unreachable (the job
 * retries); tokens Expo says are dead (DeviceNotRegistered) are pruned so we stop sending to them.
 */
const sendPush = async ({ userId, tokens, title, body, data }) => {
    const valid = (tokens || []).filter(isExpoToken);
    if (!valid.length) return false;

    const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(valid.map((to) => ({ to, title, body: String(body || '').slice(0, 300), data, sound: 'default' }))),
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Expo push failed (${response.status})`);

    const { data: tickets = [] } = await response.json().catch(() => ({}));
    const dead = valid.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
    if (dead.length && userId) await User.updateOne({ _id: userId }, { $pull: { pushTokens: { $in: dead } } });
    return true;
};

module.exports = { sendPush, isExpoToken };
