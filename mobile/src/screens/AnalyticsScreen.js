import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import api, { API_PATHS } from '../api';
import { useAuth } from '../auth';
import { colors, STATUS_COLOR, formatDate } from '../theme';

const Tile = ({ label, value, suffix = '', tone }) => (
    <View style={styles.tile}>
        <Text style={styles.tileLabel}>{label}</Text>
        <Text style={[styles.tileValue, tone && { color: tone }]}>{value}{suffix}</Text>
    </View>
);

const Bar = ({ label, value, max, color }) => (
    <View style={{ marginBottom: 10 }}>
        <View style={styles.barHeader}>
            <Text style={styles.barLabel}>{label}</Text>
            <Text style={styles.barValue}>{value}</Text>
        </View>
        <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${max ? (value / max) * 100 : 0}%`, backgroundColor: color }]} />
        </View>
    </View>
);

const AnalyticsScreen = () => {
    const { user, logout } = useAuth();
    const [data, setData] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            const response = await api.get(API_PATHS.ANALYTICS, { params: { days: 30 } });
            setData(response.data);
        } catch (error) {
            console.warn('Failed to load analytics', error.message);
        } finally {
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    if (!data) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />;

    const { totals = {}, byStatus = [], byCategory = [], upcoming = [] } = data;
    const statusMax = Math.max(1, ...byStatus.map((s) => s.count));

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
            <Text style={styles.greeting}>{user?.name}</Text>
            <Text style={styles.email}>{user?.email}</Text>

            <View style={styles.tiles}>
                <Tile label="Total tasks" value={totals.all ?? 0} />
                <Tile label="Completion" value={totals.completionRate ?? 0} suffix="%" tone="#65A30D" />
                <Tile label="Avg progress" value={totals.avgProgress ?? 0} suffix="%" tone={colors.primary} />
                <Tile label="Overdue" value={totals.overdue ?? 0} tone={colors.danger} />
            </View>

            <Text style={styles.sectionTitle}>By status</Text>
            {byStatus.map((row) => (
                <Bar key={row.status} label={row.status} value={row.count} max={statusMax} color={STATUS_COLOR[row.status] || colors.muted} />
            ))}

            <Text style={styles.sectionTitle}>By category</Text>
            {byCategory.map((row) => (
                <Bar
                    key={row.category}
                    label={`${row.category} (${row.completed}/${row.count})`}
                    value={row.avgProgress}
                    max={100}
                    color={colors.primary}
                />
            ))}
            {byCategory.length === 0 && <Text style={styles.muted}>No tasks yet.</Text>}

            <Text style={styles.sectionTitle}>Next deadlines</Text>
            {upcoming.map((task) => (
                <View key={task._id} style={styles.upcoming}>
                    <Text style={styles.upcomingTitle} numberOfLines={1}>{task.title}</Text>
                    <Text style={styles.muted}>{formatDate(task.dueDate)}</Text>
                </View>
            ))}
            {upcoming.length === 0 && <Text style={styles.muted}>Nothing scheduled.</Text>}

            <TouchableOpacity style={styles.logout} onPress={logout}>
                <Text style={styles.logoutText}>Log Out</Text>
            </TouchableOpacity>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    greeting: { fontSize: 22, fontWeight: '700', color: colors.text },
    email: { fontSize: 13, color: colors.muted, marginBottom: 16 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tile: {
        flexGrow: 1, flexBasis: '45%', backgroundColor: colors.card, borderRadius: 10,
        borderWidth: 1, borderColor: colors.border, padding: 12,
    },
    tileLabel: { fontSize: 12, color: colors.muted },
    tileValue: { fontSize: 22, fontWeight: '700', color: colors.text, marginTop: 4 },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 24, marginBottom: 10 },
    barHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    barLabel: { fontSize: 12, color: colors.text },
    barValue: { fontSize: 12, color: colors.muted },
    barTrack: { height: 6, backgroundColor: '#EEF0F5', borderRadius: 3, overflow: 'hidden' },
    barFill: { height: 6, borderRadius: 3 },
    muted: { fontSize: 12, color: colors.muted },
    upcoming: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: 8, padding: 10, marginBottom: 8, gap: 10,
    },
    upcomingTitle: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
    logout: {
        marginTop: 28, borderWidth: 1, borderColor: colors.danger, borderRadius: 10,
        paddingVertical: 12, alignItems: 'center',
    },
    logoutText: { color: colors.danger, fontWeight: '600' },
});

export default AnalyticsScreen;
