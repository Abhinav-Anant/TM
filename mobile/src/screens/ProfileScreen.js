import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import api, { API_PATHS, BASE_URL } from '../api';
import { useAuth } from '../auth';
import { Card, Field, Button, ErrorNote, notify } from '../ui';
import { colors, STATUS_COLOR } from '../theme';

const ROLE = { admin: 'Admin', head: 'Head of department', member: 'Employee' };

/**
 * Links this phone's WhatsApp so the alerts this person triggers go out from their own number.
 * A phone cannot scan a QR on its own screen, so it uses WhatsApp's pairing code instead.
 */
const WhatsAppCard = ({ defaultPhone }) => {
    const [link, setLink] = useState(null);
    const [phone, setPhone] = useState(defaultPhone || '');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        try {
            const { data } = await api.get(API_PATHS.WHATSAPP);
            setLink(data);
            if (data.status === 'connected') setCode('');
        } catch { /* keep what we have */ }
    }, []);
    useEffect(() => { refresh(); }, [refresh]);
    // Watch for the phone to connect after the code is typed in.
    useEffect(() => {
        if (!code) return undefined;
        const timer = setInterval(refresh, 3000);
        return () => clearInterval(timer);
    }, [code, refresh]);

    const run = async (fn, fallback) => {
        setBusy(true);
        setError('');
        try { await fn(); } catch (e) { setError(e.response?.data?.message || fallback); } finally { setBusy(false); }
    };
    const getCode = () => run(async () => setCode((await api.post(API_PATHS.WHATSAPP_PAIR, { phone })).data.code), 'Could not get a code.');
    const unlink = () => run(async () => { await api.post(API_PATHS.WHATSAPP_UNLINK); await refresh(); notify('WhatsApp unlinked'); }, 'Could not unlink.');

    if (!link?.enabled) return null;
    const connected = link.status === 'connected';
    return (
        <Card style={{ marginTop: 16 }}>
            <Text style={styles.cardTitle}>Your WhatsApp</Text>
            <Text style={[styles.meta, connected && { color: STATUS_COLOR.Completed }]}>{connected ? `Linked as +${link.phone}` : 'Not linked'}</Text>
            <Text style={styles.hint2}>Alerts you trigger go out from your own number: your work to your head, a head's updates to the admins. Only task messages are sent; your chats are not read or kept.</Text>
            <ErrorNote text={error} />
            {connected ? (
                <Button title="Unlink" kind="danger" onPress={unlink} busy={busy} style={{ marginTop: 10 }} />
            ) : code ? (
                <View style={{ marginTop: 10 }}>
                    <Text style={styles.code} accessibilityLabel={`Pairing code ${code.split('').join(' ')}`}>{code.slice(0, 4)}-{code.slice(4)}</Text>
                    <Text style={styles.hint2}>In WhatsApp: Linked devices, Link a device, Link with phone number instead, then type this code.</Text>
                </View>
            ) : (
                <View style={{ marginTop: 10 }}>
                    <Field label="WhatsApp number on this phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" accessibilityLabel="WhatsApp number on this phone" />
                    <Button title="Get pairing code" onPress={getCode} busy={busy} disabled={!phone.trim()} />
                </View>
            )}
        </Card>
    );
};

const ProfileScreen = ({ navigation }) => {
    const { user, logout, updateUser } = useAuth();
    const [name, setName] = useState(user?.name || '');
    const [phone, setPhone] = useState(user?.phone || '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const dirty = name.trim() !== (user?.name || '') || phone.trim() !== (user?.phone || '');

    const save = async () => {
        if (!name.trim()) { setError('Your name cannot be empty.'); return; }
        setSaving(true);
        setError('');
        try {
            const { data } = await api.put(API_PATHS.PROFILE, { name: name.trim(), phone: phone.trim() });
            updateUser({ name: data.name, phone: data.phone });
            setPhone(data.phone || ''); // show the number as the server normalised it
            notify('Saved');
        } catch (e) {
            setError(e.response?.data?.message || 'That did not save.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Card>
                <Text style={styles.name}>{user?.name}</Text>
                <Text style={styles.meta}>{user?.email}</Text>
                <Text style={styles.meta}>{ROLE[user?.role] || user?.role}</Text>
            </Card>

            <ErrorNote text={error} />
            <Field label="Name" value={name} onChangeText={setName} accessibilityLabel="Name" />
            <Field
                label="WhatsApp number" value={phone} onChangeText={setPhone} keyboardType="phone-pad"
                placeholder="e.g. 98765 43210" accessibilityLabel="WhatsApp number"
            />
            <Text style={styles.hint}>A 10-digit number is treated as Indian; include the +country code otherwise. Leave it empty to get alerts in the app only.</Text>
            <Button title="Save profile" onPress={save} busy={saving} disabled={!dirty} style={{ marginTop: 12 }} />

            <WhatsAppCard defaultPhone={user?.phone} />

            <View style={{ height: 24 }} />
            <Button title="Notification settings" kind="secondary" onPress={() => navigation.navigate('NotificationSettings')} />
            <View style={{ height: 12 }} />
            <Button title="Sign out" kind="danger" onPress={logout} />
            <Text style={styles.server}>Server: {BASE_URL}</Text>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    name: { fontSize: 18, fontWeight: '700', color: colors.text },
    meta: { fontSize: 13, color: colors.muted, marginTop: 3 },
    hint: { fontSize: 12, color: colors.muted, marginTop: -6 },
    hint2: { fontSize: 12, color: colors.muted, marginTop: 6 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
    code: { fontSize: 30, fontWeight: '700', letterSpacing: 6, color: colors.text, textAlign: 'center', marginVertical: 6 },
    server: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 20 },
});

export default ProfileScreen;
