#!/usr/bin/env python3
"""
Patches a Blastup checkout for TaskManager's use: every employee links their OWN phone, and
TaskManager only ever sends task alerts through it. Idempotent; each edit asserts its anchor so an
upstream change fails loudly instead of silently skipping a privacy patch.

    python3 patch-blastup.py /opt/blastup

What it changes, and why:
  1. Privacy. Employees link personal WhatsApp accounts. Stock Blastup syncs full history, saves every
     chat, contact and incoming message to its database, and can auto-reply (chatbot/AI) to incoming
     messages. All of that is switched off: no history sync, and the history/contacts/incoming
     handlers return immediately unless READ_INCOMING=true. Outgoing alerts are still recorded.
  2. markOnlineOnConnect off. A linked device that shows "online" stops the phone getting its own
     notifications - unacceptable on someone's personal phone.
  3. Pairing code. A phone cannot scan a QR shown on its own screen, so POST /api/whatsapp/pair
     {phone} returns WhatsApp's 8-character "link with phone number" code instead.
  4. Safe Mode default tier from SAFE_MODE_DEFAULT_TIER. Tiers 1-2 block links (every alert has one)
     and Tier 1 allows no new chats, so a new account would never reach a colleague.
  5. Sending window from SENDING_WINDOW_START_UTC / _END_UTC. The stock 09-21 UTC is 14:30-02:30 IST
     and violations are dropped, not queued.
  6. API binds 127.0.0.1 (BIND_HOST to widen). Stock listen() binds every interface.
"""
import io
import sys

root = sys.argv[1] if len(sys.argv) > 1 else "/opt/blastup"
src = f"{root}/server/src"


def patch(rel, edits):
    path = f"{src}/{rel}"
    s = io.open(path, encoding="utf-8").read()
    changed = False
    for marker, old, new in edits:
        if marker in s:
            continue
        assert old in s, f"{rel}: anchor not found (upstream changed?): {old[:60]!r}"
        s = s.replace(old, new, 1)
        changed = True
    if changed:
        io.open(path, "w", encoding="utf-8", newline="").write(s)
    print(f"  {rel}: {'patched' if changed else 'already patched'}")


PAIRING = """

/** TaskManager patch: link by WhatsApp's 8-character code instead of scanning a QR. */
export async function requestPairingCode(instanceId: string, phone: string): Promise<string> {
  const digits = String(phone || '').replace(/\\D/g, '');
  if (digits.length < 8) throw new Boom('Phone number with country code required', { statusCode: 400 });
  if (getSocket(instanceId)?.authState?.creds?.registered) throw new Boom('Already linked', { statusCode: 409 });
  // A pairing code can only be requested once the socket is up and waiting for a login, which is
  // exactly when the first QR is emitted.
  const waiting = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Boom('WhatsApp did not answer in time', { statusCode: 504 })), 30000);
    waEvents.once(`qr:${instanceId}`, () => { clearTimeout(timer); resolve(); });
  });
  await restartWhatsApp(instanceId);
  await waiting;
  const sock = getSocket(instanceId);
  if (!sock) throw new Boom('WhatsApp socket is not running', { statusCode: 503 });
  return sock.requestPairingCode(digits);
}
"""

patch("services/whatsapp.service.ts", [
    ("shouldSyncHistoryMessage", "      syncFullHistory: true,",
     "      syncFullHistory: false,\n      shouldSyncHistoryMessage: () => false,"),
    ("markOnlineOnConnect: false", "      markOnlineOnConnect: true,", "      markOnlineOnConnect: false,"),
    ("READ_INCOMING !== 'true') return; // history",
     "    (sock.ev as any).on('messaging-history.set', async (data: any) => {\n",
     "    (sock.ev as any).on('messaging-history.set', async (data: any) => {\n"
     "      if (process.env.READ_INCOMING !== 'true') return; // history\n"),
    ("READ_INCOMING !== 'true') return; // contacts",
     "    sock.ev.on('contacts.upsert', async (contacts) => {\n",
     "    sock.ev.on('contacts.upsert', async (contacts) => {\n"
     "      if (process.env.READ_INCOMING !== 'true') return; // contacts\n"),
    ("READ_INCOMING !== 'true') return;\n", "      if (type !== 'notify') return;\n",
     "      if (type !== 'notify' || process.env.READ_INCOMING !== 'true') return;\n"),
    ("SAFE_MODE_DEFAULT_TIER", "(instance.safeModeStartTier || 1) as any",
     "(instance.safeModeStartTier || Number(process.env.SAFE_MODE_DEFAULT_TIER || 1)) as any"),
    ("export async function requestPairingCode", "export async function deleteSession(",
     PAIRING.lstrip("\n") + "\nexport async function deleteSession("),
])

patch("controllers/whatsapp.controller.ts", [
    ("export async function pair", "export async function deleteSession(",
     "export async function pair(req: AuthRequest, res: Response, next: NextFunction) {\n"
     "  try {\n"
     "    const code = await wa.requestPairingCode(req.user?.id || 'default', req.body?.phone);\n"
     "    res.json({ success: true, data: { code } });\n"
     "  } catch (err) {\n"
     "    next(err);\n"
     "  }\n"
     "}\n\n"
     "export async function deleteSession("),
])

patch("routes/whatsapp.routes.ts", [
    ("'/pair'", "export default router;",
     "// TaskManager patch: link with a pairing code (see services/whatsapp.service.ts).\n"
     "router.post('/pair', qrLimiter, waController.pair);\n\nexport default router;"),
])

patch("safemode/tiers.ts", [
    ("process.env.SENDING_WINDOW_START_UTC",
     "export const SENDING_WINDOW_START_UTC = 9;\nexport const SENDING_WINDOW_END_UTC = 21;",
     "export const SENDING_WINDOW_START_UTC = Number(process.env.SENDING_WINDOW_START_UTC ?? 9);\n"
     "export const SENDING_WINDOW_END_UTC = Number(process.env.SENDING_WINDOW_END_UTC ?? 21);"),
])

patch("index.ts", [
    ("BIND_HOST", "    server.listen(env.PORT, () => {",
     "    server.listen(env.PORT, process.env.BIND_HOST || '127.0.0.1', () => {"),
])
