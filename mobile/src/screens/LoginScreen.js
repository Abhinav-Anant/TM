import React, { useState } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, StyleSheet,
    KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useAuth } from '../auth';
import { BASE_URL } from '../api';
import { colors } from '../theme';

const LoginScreen = () => {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        setError('');
        if (!email.trim() || !password) {
            setError('Email and password are required.');
            return;
        }

        setBusy(true);
        try {
            await login(email.trim(), password);
        } catch (err) {
            setError(err.response?.data?.message || 'Login failed. Check the server URL and your credentials.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <Text style={styles.title}>Task Manager</Text>
            <Text style={styles.subtitle}>Sign in to your workspace</Text>

            <TextInput
                style={styles.input}
                placeholder="Email"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
            />
            <TextInput
                style={styles.input}
                placeholder="Password"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={submit}
            />

            {!!error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity style={[styles.button, busy && styles.buttonBusy]} onPress={submit} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log In</Text>}
            </TouchableOpacity>

            <Text style={styles.hint}>Server: {BASE_URL}</Text>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
    title: { fontSize: 28, fontWeight: '700', color: colors.text },
    subtitle: { fontSize: 14, color: colors.muted, marginTop: 4, marginBottom: 24 },
    input: {
        backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12,
    },
    button: {
        backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14,
        alignItems: 'center', marginTop: 8,
    },
    buttonBusy: { opacity: 0.7 },
    buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
    error: { color: colors.danger, fontSize: 13, marginBottom: 8 },
    hint: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 20 },
});

export default LoginScreen;
