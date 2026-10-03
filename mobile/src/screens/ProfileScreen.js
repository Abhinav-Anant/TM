import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import api, { API_PATHS, BASE_URL } from '../api';
import { useAuth } from '../auth';
import { Card, Field, Button, ErrorNote, notify } from '../ui';
import { colors } from '../theme';

const ROLE = { admin: 'Admin', head: 'Head of department', member: 'Employee' };

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
    server: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 20 },
});

export default ProfileScreen;
