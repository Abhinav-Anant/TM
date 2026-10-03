/**
 * What each person wants to hear about, and where. Stored on the user as OVERRIDES only
 * (`notificationPrefs`), so a new event or a changed default reaches everyone who never touched it.
 *
 *   channels: { whatsapp, email, push }       master switches (false = never, regardless of events)
 *   events:   { <event>: { inApp, whatsapp, email, push } }
 */
const CHANNELS = ['inApp', 'whatsapp', 'email', 'push'];
const SWITCHABLE = ['whatsapp', 'email', 'push']; // in-app has no master switch: it is the inbox

const on = (inApp, whatsapp, email, push) => ({ inApp, whatsapp, email, push });

// group 'main' = the ten things the spec calls out; 'other' = everything else the app already says.
const EVENTS = {
    assigned:     { label: 'Task assigned',        group: 'main',  defaults: on(true, true, false, true) },
    reassigned:   { label: 'Task reassigned',      group: 'main',  defaults: on(true, true, false, true) },
    mention:      { label: 'Mentioned',            group: 'main',  defaults: on(true, false, false, true) },
    due_tomorrow: { label: 'Due tomorrow',         group: 'main',  defaults: on(true, true, false, false) },
    due_today:    { label: 'Due today',            group: 'main',  defaults: on(true, true, true, true) },
    overdue:      { label: 'Overdue',              group: 'main',  defaults: on(true, true, true, true) },
    completed:    { label: 'Task completed',       group: 'main',  defaults: on(true, true, false, false) },
    review:       { label: 'Sent for review',      group: 'main',  defaults: on(true, true, false, true) },
    approved:     { label: 'Task approved',        group: 'main',  defaults: on(true, true, false, true) },
    blocked:      { label: 'Task blocked',         group: 'main',  defaults: on(true, true, false, true) },
    updated:      { label: 'Task updated',         group: 'other', defaults: on(true, true, false, false) },
    status:       { label: 'Status changed',       group: 'other', defaults: on(true, true, false, false) },
    comment:      { label: 'New comment',          group: 'other', defaults: on(true, true, false, false) },
    escalation:   { label: 'Escalations',          group: 'other', defaults: on(true, true, true, true) },
};

// Notification.type -> preference event, when the caller does not name one.
const TYPE_EVENT = {
    assigned: 'assigned', reassigned: 'reassigned', mention: 'mention', completed: 'completed',
    approved: 'approved', blocked: 'blocked', review: 'review', overdue: 'overdue',
    deadline: 'due_tomorrow', updated: 'updated', status: 'status', comment: 'comment', escalation: 'escalation',
};

const eventFor = (type, event) => (EVENTS[event] ? event : (TYPE_EVENT[type] || null));

/** Does `user` want `event` on `channel`? Unknown events default to on (never silently drop an alert). */
const wants = (user, event, channel) => {
    const prefs = user?.notificationPrefs || {};
    if (SWITCHABLE.includes(channel) && prefs.channels?.[channel] === false) return false;
    const override = prefs.events?.[event]?.[channel];
    if (typeof override === 'boolean') return override;
    return EVENTS[event]?.defaults[channel] ?? true;
};

/** The full effective table for the settings screen. */
const describe = (user) => ({
    channels: Object.fromEntries(SWITCHABLE.map((c) => [c, user?.notificationPrefs?.channels?.[c] !== false])),
    events: Object.entries(EVENTS).map(([key, meta]) => ({
        key, label: meta.label, group: meta.group,
        ...Object.fromEntries(CHANNELS.map((c) => [c, wants({ notificationPrefs: { ...user?.notificationPrefs, channels: {} } }, key, c)])),
    })),
});

/**
 * Validates an update body and merges it into the stored overrides.
 * Returns { prefs } or { error }.
 */
const mergePrefs = (current = {}, body = {}) => {
    const next = { channels: { ...(current.channels || {}) }, events: { ...(current.events || {}) } };

    if (body.channels !== undefined) {
        if (typeof body.channels !== 'object' || body.channels === null) return { error: 'channels must be an object' };
        for (const [channel, value] of Object.entries(body.channels)) {
            if (!SWITCHABLE.includes(channel)) return { error: `unknown channel "${channel}"` };
            if (typeof value !== 'boolean') return { error: `channels.${channel} must be true or false` };
            next.channels[channel] = value;
        }
    }
    if (body.events !== undefined) {
        if (typeof body.events !== 'object' || body.events === null) return { error: 'events must be an object' };
        for (const [event, channels] of Object.entries(body.events)) {
            if (!EVENTS[event]) return { error: `unknown event "${event}"` };
            if (typeof channels !== 'object' || channels === null) return { error: `events.${event} must be an object` };
            next.events[event] = { ...(next.events[event] || {}) };
            for (const [channel, value] of Object.entries(channels)) {
                if (!CHANNELS.includes(channel)) return { error: `unknown channel "${channel}"` };
                if (typeof value !== 'boolean') return { error: `events.${event}.${channel} must be true or false` };
                next.events[event][channel] = value;
            }
        }
    }
    return { prefs: next };
};

module.exports = { EVENTS, CHANNELS, eventFor, wants, describe, mergePrefs };
