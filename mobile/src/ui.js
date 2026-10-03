import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Alert, Platform } from 'react-native';
import { colors, STATUS_COLOR, PRIORITY_COLOR } from './theme';
import { quickDays } from './lib/logic';

/** Alert.alert is a silent no-op on web, so errors would vanish there; use the browser's own box instead. */
export const notify = (title, message) => (
    Platform.OS === 'web' ? window.alert(message ? `${title}
${message}` : title) : Alert.alert(title, message)
);

export const Badge = ({ label, color }) => (
    <View style={[styles.badge, { backgroundColor: `${color || colors.muted}22` }]}>
        <Text style={[styles.badgeText, { color: color || colors.muted }]}>{label}</Text>
    </View>
);
export const StatusBadge = ({ status }) => <Badge label={status} color={STATUS_COLOR[status]} />;
export const PriorityBadge = ({ priority }) => <Badge label={priority} color={PRIORITY_COLOR[priority]} />;

export const Chip = ({ label, active, onPress, color, disabled }) => (
    <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ selected: !!active, disabled: !!disabled }}
        disabled={disabled}
        style={[styles.chip, active && { backgroundColor: color || colors.primary, borderColor: color || colors.primary }, disabled && { opacity: 0.4 }]}
        onPress={onPress}
    >
        <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
);

/** A row of single-choice chips that scrolls sideways when it does not fit. */
export const ChipRow = ({ options, value, onChange, style }) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.chipRow, style]} keyboardShouldPersistTaps="handled">
        {options.map((o) => {
            const opt = typeof o === 'string' ? { label: o, value: o } : o;
            return <Chip key={String(opt.value)} label={opt.label} active={value === opt.value} color={opt.color} onPress={() => onChange(opt.value)} />;
        })}
    </ScrollView>
);

export const Button = ({ title, onPress, kind = 'primary', busy, disabled, style }) => (
    <TouchableOpacity
        accessibilityRole="button"
        onPress={onPress}
        disabled={busy || disabled}
        style={[styles.button, kind === 'secondary' && styles.buttonSecondary, kind === 'danger' && styles.buttonDanger, (busy || disabled) && { opacity: 0.5 }, style]}
    >
        {busy ? <ActivityIndicator color={kind === 'secondary' ? colors.primary : '#fff'} /> : (
            <Text style={[styles.buttonText, kind === 'secondary' && { color: colors.primary }]}>{title}</Text>
        )}
    </TouchableOpacity>
);

export const Field = ({ label, error, style, ...props }) => (
    <View style={[{ marginBottom: 14 }, style]}>
        {!!label && <Text style={styles.label}>{label}</Text>}
        <TextInput placeholderTextColor="#9CA3AF" style={[styles.input, props.multiline && { minHeight: 80, textAlignVertical: 'top' }, !!error && { borderColor: colors.danger }]} {...props} />
        {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
);

/** Typed date (YYYY-MM-DD) plus quick picks. No native picker, so it behaves the same on every platform. */
export const DateField = ({ label, value, onChange, error }) => (
    <View style={{ marginBottom: 14 }}>
        {!!label && <Text style={styles.label}>{label}</Text>}
        <TextInput
            style={[styles.input, !!error && { borderColor: colors.danger }]}
            placeholder="YYYY-MM-DD (optional)"
            placeholderTextColor="#9CA3AF"
            value={value}
            onChangeText={onChange}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }} keyboardShouldPersistTaps="handled">
            {quickDays().map(([name, day]) => <Chip key={name} label={name} active={value === day} onPress={() => onChange(day)} />)}
            {!!value && <Chip label="Clear" onPress={() => onChange('')} />}
        </ScrollView>
        {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
);

export const Card = ({ children, style, onPress }) => (
    onPress
        ? <TouchableOpacity accessibilityRole="button" style={[styles.card, style]} onPress={onPress}>{children}</TouchableOpacity>
        : <View style={[styles.card, style]}>{children}</View>
);

export const Section = ({ title, right, children }) => (
    <View style={{ marginTop: 22 }}>
        <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {right}
        </View>
        {children}
    </View>
);

export const Empty = ({ text }) => <Text style={styles.empty}>{text}</Text>;
export const Loading = () => <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} size="large" />;
export const ErrorNote = ({ text }) => (text ? <Text style={styles.errorBanner} accessibilityRole="alert">{text}</Text> : null);

export const ProgressBar = ({ value = 0, color }) => (
    <View style={styles.track}><View style={[styles.fill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color || colors.primary }]} /></View>
);

export const Tile = ({ label, value, tone, onPress }) => (
    <TouchableOpacity style={styles.tile} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}>
        <Text style={styles.tileLabel}>{label}</Text>
        <Text style={[styles.tileValue, tone && { color: tone }]}>{value ?? '–'}</Text>
    </TouchableOpacity>
);

export const styles = StyleSheet.create({
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    badgeText: { fontSize: 11, fontWeight: '600' },
    chipRow: { flexGrow: 0, flexShrink: 0, paddingVertical: 2 },
    chip: {
        borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
        paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, marginRight: 8, marginVertical: 2,
    },
    chipText: { fontSize: 12, color: colors.muted },
    chipTextActive: { color: '#fff', fontWeight: '600' },
    button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
    buttonSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
    buttonDanger: { backgroundColor: colors.danger },
    buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
    label: { fontSize: 12, fontWeight: '600', color: colors.muted, marginBottom: 6 },
    input: {
        backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
        paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.text,
    },
    error: { color: colors.danger, fontSize: 12, marginTop: 4 },
    errorBanner: { color: colors.danger, backgroundColor: '#FEE2E2', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 13 },
    card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
    sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
    empty: { textAlign: 'center', color: colors.muted, marginTop: 32, paddingHorizontal: 24 },
    track: { height: 5, backgroundColor: '#EEF0F5', borderRadius: 3, overflow: 'hidden' },
    fill: { height: 5, borderRadius: 3 },
    tile: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border },
    tileLabel: { fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
    tileValue: { fontSize: 28, fontWeight: '700', color: colors.text, marginTop: 4 },
});
