import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';

const CHANNELS = [
  ['inApp', 'In-app'],
  ['whatsapp', 'WhatsApp'],
  ['email', 'Email'],
  ['push', 'Push'],
];

/**
 * Per-event choices (a grid of checkboxes) plus a master switch per channel. Every change saves
 * straight away: a settings page with a Save button is one more thing to forget.
 */
const NotificationSettings = () => {
  const [prefs, setPrefs] = useState(null);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    axiosInstance.get(API_PATHS.NOTIFICATIONS.PREFERENCES)
      .then(({ data }) => setPrefs(data))
      .catch(() => toast.error('Could not load your notification settings.'));
  }, []);

  const save = async (body, optimistic) => {
    const before = prefs;
    setPrefs(optimistic);
    try {
      const { data } = await axiosInstance.put(API_PATHS.NOTIFICATIONS.PREFERENCES, body);
      setPrefs(data);
    } catch (error) {
      setPrefs(before);
      toast.error(error.response?.data?.message || 'That did not save.');
    }
  };

  const setChannel = (channel, value) => save(
    { channels: { [channel]: value } },
    { ...prefs, channels: { ...prefs.channels, [channel]: value } },
  );

  const setEvent = (key, channel, value) => save(
    { events: { [key]: { [channel]: value } } },
    { ...prefs, events: prefs.events.map((e) => (e.key === key ? { ...e, [channel]: value } : e)) },
  );

  if (!prefs) return <div className="panel p-6 mt-5"><div className="skeleton h-40" /></div>;

  const { availability } = prefs;
  const notes = {
    whatsapp: !availability.whatsapp.configured ? 'Not set up on this server.' : !availability.whatsapp.hasPhone ? 'Add your number above first.' : null,
    email: !availability.email.configured ? 'Not set up on this server.' : null,
    push: availability.push.devices === 0 ? 'Sign in on the mobile app to receive these.' : null,
  };
  const rows = prefs.events.filter((e) => e.group === 'main' || showMore);

  return (
    <section className="panel p-6 mt-5" aria-labelledby="notif-heading">
      <h3 id="notif-heading" className="font-display text-lg text-beam">Notifications</h3>
      <p className="text-sm text-mist mt-1 mb-5">Choose what reaches you, and where.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {['whatsapp', 'email', 'push'].map((channel) => (
          <label key={channel} className="panel-sunken rounded-lg p-3 cursor-pointer block">
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-beam">{CHANNELS.find(([id]) => id === channel)[1]}</span>
              <input type="checkbox" checked={prefs.channels[channel]} onChange={(e) => setChannel(channel, e.target.checked)} />
            </span>
            <span className="block text-xs text-dusk mt-1">{notes[channel] || (prefs.channels[channel] ? 'On' : 'Off for everything')}</span>
          </label>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Which events notify you on which channel</caption>
          <thead>
            <tr className="text-left text-xs text-dusk">
              <th scope="col" className="py-2 pr-4 font-medium">Event</th>
              {CHANNELS.map(([id, label]) => <th key={id} scope="col" className="py-2 px-3 font-medium text-center">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((event) => (
              <tr key={event.key} className="border-t border-white/8">
                <th scope="row" className="py-2.5 pr-4 text-left font-normal text-beam">{event.label}</th>
                {CHANNELS.map(([id, label]) => (
                  <td key={id} className="py-2.5 px-3 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${event.label} by ${label}`}
                      checked={event[id]}
                      disabled={id !== 'inApp' && !prefs.channels[id]}
                      onChange={(e) => setEvent(event.key, id, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" className="text-xs text-signal hover:underline cursor-pointer mt-3" onClick={() => setShowMore((v) => !v)}>
        {showMore ? 'Show fewer events' : 'Show more events'}
      </button>
    </section>
  );
};

export default NotificationSettings;
