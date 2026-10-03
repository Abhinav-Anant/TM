import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Switch, StyleSheet } from 'react-native';
import api, { API_PATHS } from '../api';
import { Card, Loading, ErrorNote, notify } from '../ui';
import { colors } from '../theme';

const CHANNELS = [['inApp', 'In-app'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['push', 'Push']];

/** Master switches plus a switch per event and channel. Each change saves immediately. */
const NotificationSettingsScreen = () => {
    const [prefs, setPrefs] = useState(null);
    const [error, setError] = useState('');
    const [showMore, setShowMore] = useState(false);

    useEffect(() => {
        api.get(API_PATHS.PREFERENCES).then(({ data }) => setPrefs(data)).catch((e) => setError(e.response?.data?.message || 'Could not load your settings.'));
    }, []);

    const save = async (body, optimistic) => {
        const before = prefs;
        setPrefs(optimistic);
        try {
            const { data } = await api.put(API_PATHS.PREFERENCES, body);
            setPrefs(data);
        } catch (e) {
            setPrefs(before);
            notify('That did not save', e.response?.data?.message);
        }
    };

    const setChannel = (channel, value) => save({ channels: { [channel]: value } }, { ...prefs, channels: { ...prefs.channels, [channel]: value } });
    const setEvent = (key, channel, value) => save(
        { events: { [key]: { [channel]: value } } },
        { ...prefs, events: prefs.events.map((e) => (e.key === key ? { ...e, [channel]: value } : e)) },
    );

    if (!prefs) return error ? <ErrorNote text={error} /> : <Loading />;

    const a = prefs.availability;
    const notes = {
        whatsapp: !a.whatsapp.configured ? 'Not set up on this server.' : !a.whatsapp.hasPhone ? 'Add your number in Profile first.' : null,
        email: !a.email.configured ? 'Not set up on this server.' : null,
        push: a.push.devices === 0 ? 'This phone is not registered for push yet.' : null,
    };
    const rows = prefs.events.filter((e) => e.group === 'main' || showMore);

    return (
        <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <Text style={styles.heading}>Where to reach me</Text>
            {['whatsapp', 'email', 'push'].map((channel) => (
                <Card key={channel}>
                    <View style={styles.switchRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.name}>{CHANNELS.find(([id]) => id === channel)[1]}</Text>
                            <Text style={styles.note}>{notes[channel] || (prefs.channels[channel] ? 'On' : 'Off for everything')}</Text>
                        </View>
                        <Switch value={prefs.channels[channel]} onValueChange={(v) => setChannel(channel, v)} accessibilityLabel={`${channel} notifications`} />
                    </View>
                </Card>
            ))}

            <Text style={[styles.heading, { marginTop: 18 }]}>What to tell me</Text>
            {rows.map((event) => (
                <Card key={event.key}>
                    <Text style={styles.name}>{event.label}</Text>
                    <View style={styles.channels}>
                        {CHANNELS.map(([id, label]) => (
                            <View key={id} style={styles.channel}>
                                <Text style={styles.channelLabel}>{label}</Text>
                                <Switch
                                    value={!!event[id]} disabled={id !== 'inApp' && !prefs.channels[id]}
                                    onValueChange={(v) => setEvent(event.key, id, v)} accessibilityLabel={`${event.label} by ${label}`}
                                />
                            </View>
                        ))}
                    </View>
                </Card>
            ))}
            <Text style={styles.more} onPress={() => setShowMore((v) => !v)} accessibilityRole="button">{showMore ? 'Show fewer events' : 'Show more events'}</Text>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    heading: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 8 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    name: { fontSize: 14, fontWeight: '600', color: colors.text },
    note: { fontSize: 12, color: colors.muted, marginTop: 2 },
    channels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
    channel: { alignItems: 'center', gap: 4 },
    channelLabel: { fontSize: 10, color: colors.muted },
    more: { color: colors.primary, fontSize: 13, textAlign: 'center', marginTop: 8 },
});

export default NotificationSettingsScreen;
