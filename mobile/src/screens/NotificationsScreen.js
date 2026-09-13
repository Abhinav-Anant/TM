import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import api, { API_PATHS } from '../api';
import { colors, formatDate } from '../theme';

// ponytail: 30s polling. React Native's fetch cannot stream a response body, so the
// web SSE channel does not apply here - swap for expo-notifications push if you need instant alerts.
const POLL_MS = 30000;

const TYPE_COLOR = {
    assigned: colors.primary,
    updated: '#F59E0B',
    status: '#65A30D',
    comment: '#8D51FF',
    deadline: '#EA580C',
    overdue: colors.danger,
};

const NotificationsScreen = ({ navigation }) => {
    const [items, setItems] = useState([]);
    const [unread, setUnread] = useState(0);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            const { data } = await api.get(API_PATHS.NOTIFICATIONS);
            setItems(data?.notifications || []);
            setUnread(data?.unreadCount || 0);
        } catch (error) {
            console.warn('Failed to load notifications', error.message);
        } finally {
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        load();
        const timer = setInterval(load, POLL_MS);
        return () => clearInterval(timer);
    }, [load]);

    useEffect(() => navigation.addListener('focus', load), [navigation, load]);

    const open = async (item) => {
        if (!item.read) {
            setItems((prev) => prev.map((n) => (n._id === item._id ? { ...n, read: true } : n)));
            setUnread((n) => Math.max(0, n - 1));
            api.put(API_PATHS.MARK_READ(item._id)).catch(load);
        }

        const taskId = item.task?._id || item.task;
        if (taskId) navigation.navigate('Tasks', { screen: 'TaskDetail', params: { id: taskId, title: item.title } });
    };

    const markAll = async () => {
        setItems((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnread(0);
        api.put(API_PATHS.MARK_ALL_READ).catch(load);
    };

    return (
        <View style={styles.container}>
            {unread > 0 && (
                <TouchableOpacity style={styles.markAll} onPress={markAll}>
                    <Text style={styles.markAllText}>Mark all {unread} as read</Text>
                </TouchableOpacity>
            )}

            <FlatList
                data={items}
                keyExtractor={(item) => item._id}
                contentContainerStyle={{ padding: 12 }}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
                }
                renderItem={({ item }) => (
                    <TouchableOpacity style={[styles.row, !item.read && styles.rowUnread]} onPress={() => open(item)}>
                        <View style={[styles.dot, { backgroundColor: TYPE_COLOR[item.type] || colors.muted }]} />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
                            {!!item.message && <Text style={styles.rowMessage} numberOfLines={2}>{item.message}</Text>}
                            <Text style={styles.rowDate}>{formatDate(item.createdAt)}</Text>
                        </View>
                    </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={styles.empty}>You're all caught up.</Text>}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    markAll: { padding: 12, alignItems: 'flex-end' },
    markAllText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
    row: {
        flexDirection: 'row', gap: 10, backgroundColor: colors.card, borderRadius: 10,
        borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8,
    },
    rowUnread: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
    dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
    rowTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
    rowMessage: { fontSize: 12, color: colors.muted, marginTop: 2 },
    rowDate: { fontSize: 11, color: colors.muted, marginTop: 4 },
    empty: { textAlign: 'center', color: colors.muted, marginTop: 40 },
});

export default NotificationsScreen;
