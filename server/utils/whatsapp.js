// WhatsApp delivery via a self-hosted Blastup gateway (Baileys socket).
// Opt-in exactly like the email transport it replaces: without both env vars
// every send is a silent no-op, so the app runs fine before the gateway exists.
const { BLASTUP_URL, BLASTUP_API_KEY } = process.env;

const whatsappEnabled = Boolean(BLASTUP_URL && BLASTUP_API_KEY);

// Blastup caps a text message at 4096 characters and rejects the whole request
// past that, so truncate rather than lose the notification entirely.
const MAX_TEXT = 4096;

/**
 * Sends one WhatsApp message. Never throws: a notification is best-effort and
 * must not take down the request that triggered it - the in-app alert and the
 * SSE push have already landed by the time we get here.
 */
const sendWhatsApp = async ({ to, text }) => {
    if (!whatsappEnabled || !to || !text) return false;

    try {
        // The gateway holds a WhatsApp socket open; a wedged one would otherwise
        // hang this request for as long as the platform's default timeout.
        const response = await fetch(`${BLASTUP_URL.replace(/\/$/, "")}/api/send/text`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": BLASTUP_API_KEY,
            },
            body: JSON.stringify({ to, text: text.slice(0, MAX_TEXT) }),
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            // Body first - Blastup reports "not connected" and per-number
            // failures as a 4xx with a reason worth having in the log.
            const detail = await response.text().catch(() => "");
            console.error(`WhatsApp send failed (${response.status}):`, detail.slice(0, 300));
            return false;
        }

        return true;
    } catch (error) {
        console.error("WhatsApp send failed:", error.message);
        return false;
    }
};

module.exports = { sendWhatsApp, whatsappEnabled };
