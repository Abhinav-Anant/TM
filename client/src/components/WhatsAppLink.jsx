import React, { useCallback, useEffect, useState } from 'react';
import { LuQrCode, LuSmartphone, LuUnlink } from 'react-icons/lu';
import toast from 'react-hot-toast';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';

const errorText = (error, fallback) => error?.response?.data?.message || fallback;

/**
 * Links the member's own WhatsApp so their task alerts go out from their number: a QR to scan from a
 * computer, or WhatsApp's pairing code when the phone is the only screen they have. Hidden when the
 * server has no WhatsApp gateway.
 */
const WhatsAppLink = ({ defaultPhone }) => {
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState(defaultPhone || '');
  const [code, setCode] = useState('');

  const refresh = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get(API_PATHS.WHATSAPP.ME);
      setLink(data);
      if (data.status === 'connected') setCode('');
    } catch {
      setLink((current) => current || { enabled: true, status: 'unknown' });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setPhone((current) => current || defaultPhone || ''); }, [defaultPhone]);

  // While waiting for the scan or the code, watch for the phone to connect (and for fresh QR codes).
  const waiting = link && (link.status === 'qr_ready' || link.status === 'connecting' || code);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  const act = async (fn, fallback) => {
    setBusy(true);
    try { await fn(); } catch (error) { toast.error(errorText(error, fallback)); } finally { setBusy(false); }
  };

  const showQr = () => act(async () => {
    setCode('');
    await axiosInstance.post(API_PATHS.WHATSAPP.LINK);
    setLink((current) => ({ ...current, status: 'connecting' }));
  }, 'Could not start linking');

  const getCode = (e) => {
    e.preventDefault();
    act(async () => {
      const { data } = await axiosInstance.post(API_PATHS.WHATSAPP.PAIR, { phone });
      setCode(data.code);
    }, 'Could not get a pairing code');
  };

  const unlink = () => act(async () => {
    await axiosInstance.post(API_PATHS.WHATSAPP.UNLINK);
    toast.success('WhatsApp unlinked');
    await refresh();
  }, 'Could not unlink');

  if (!link || !link.enabled) return null;
  const connected = link.status === 'connected';

  return (
    <section className="panel p-6 mt-5" aria-labelledby="wa-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="wa-heading" className="font-display text-lg text-beam">Your WhatsApp</h3>
        <span className={`chip ${connected ? 'chip-done' : 'chip-pending'}`}>
          {connected ? `Linked as +${link.phone}` : 'Not linked'}
        </span>
      </div>
      <p className="text-sm text-mist mt-1">
        Link your phone and the alerts you trigger go out from your own number: your work to your head,
        a head&apos;s updates to the admins. Task Manager only sends task messages; it does not read or keep your chats.
      </p>

      {connected && (
        <div className="flex justify-end mt-5">
          <button type="button" className="btn btn-danger" onClick={unlink} disabled={busy}>
            <LuUnlink /> Unlink
          </button>
        </div>
      )}

      {!connected && link.status === 'qr_ready' && link.qr && !code && (
        <div className="mt-5 flex flex-col sm:flex-row gap-5 items-start">
          <img src={link.qr} alt="WhatsApp link QR code" className="w-56 h-56 rounded-lg bg-white p-2" />
          <ol className="text-sm text-mist list-decimal pl-5 space-y-1.5">
            <li>Open WhatsApp on your phone.</li>
            <li>Tap <span className="text-beam">Settings</span> (or the menu) and choose <span className="text-beam">Linked devices</span>.</li>
            <li>Tap <span className="text-beam">Link a device</span> and point the camera at this code.</li>
            <li className="text-dusk">The code refreshes by itself; this card turns green once you are linked.</li>
          </ol>
        </div>
      )}

      {!connected && link.status === 'connecting' && !code && (
        <div className="mt-5 skeleton h-24" aria-label="Preparing the QR code" />
      )}

      {!connected && code && (
        <div className="mt-5 panel-sunken rounded-lg p-4">
          <p className="text-sm text-mist">Your pairing code</p>
          <p className="font-display text-3xl tracking-[0.3em] text-beam num mt-1">{code.slice(0, 4)}-{code.slice(4)}</p>
          <ol className="text-sm text-mist list-decimal pl-5 space-y-1.5 mt-3">
            <li>In WhatsApp go to <span className="text-beam">Linked devices</span> and tap <span className="text-beam">Link a device</span>.</li>
            <li>Tap <span className="text-beam">Link with phone number instead</span> and type this code.</li>
          </ol>
        </div>
      )}

      {!connected && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="panel-sunken rounded-lg p-4">
            <p className="text-sm text-beam font-medium">On a computer</p>
            <p className="text-xs text-dusk mt-1 mb-3">Scan a QR code with your phone.</p>
            <button type="button" className="btn btn-primary" onClick={showQr} disabled={busy}>
              <LuQrCode /> Show QR code
            </button>
          </div>
          <form className="panel-sunken rounded-lg p-4" onSubmit={getCode}>
            <label className="text-sm text-beam font-medium block" htmlFor="wa-pair-phone">On this phone</label>
            <p className="text-xs text-dusk mt-1 mb-3">Get a code to type into WhatsApp.</p>
            <div className="flex gap-2">
              <input
                id="wa-pair-phone" type="tel" className="field num" placeholder="WhatsApp number"
                value={phone} onChange={(e) => setPhone(e.target.value)} required
              />
              <button type="submit" className="btn shrink-0" disabled={busy}>
                <LuSmartphone /> Get code
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};

export default WhatsAppLink;
