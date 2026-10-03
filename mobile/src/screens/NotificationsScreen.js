import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import api, { API_PATHS } from '../api';
import { useUnread } from '../unread';
import { Empty, ErrorNote, Loading } from '../ui';
import { colors, formatDate } from '../theme';

const TYPE_COLOR = {
    assigned: colors.primary,
    reassigned: colors.primary,
    mention: '#0EA5E9',
    updated: '#F59E0B',
    status: '#65A30D',
    completed: '#65A30D',
    approved: '#65A30D',
    review: '#F59E0B',
    comment: '#8D51FF',
    deadline: '#EA580C',
    overdue: colors.danger,
    blocked: colors.danger,
    escalation: colors.danger,
};

const NotificationsScreen = ({ navigation }) => {
    const { refreshUnread, setUnread } = useUnread();
    const [items, setItems] = useState([]);
    const [unread, setLocalUnread] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const { data } = await api.get(API_PATHS.NOTIFICATIONS, { params: { limit: 50 } });
            setItems(data?.notifications || []);
            setLocalUnread(data?.unreadCount || 0);
            setUnread(data?.unreadCount || 0);
            setError('');
        } catch (e) {
            setError(e.response?.data?.message || 'Could not load notifications. Pull down to try again.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [setUnread]);

    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => { load(); }, [load]);

    const open = (item) => {
        if (!item.read) {
            setItems((prev) => prev.map((n) => (n._id === item._id ? { ...n, read: true } : n)));
            setLocalUnread((n) => Math.max(0, n - 1));
            api.put(API_PATHS.MARK_READ(item._id)).then(refreshUnread).catch(load);
        }
        const taskId = item.task?._id || item.task;
        if (taskId) navigation.navigate('TaskDetail', { id: taskId, title: item.task?.title || item.title });
    };

    const markAll = () => {
        setItems((prev) => prev.map((n) => ({ ...n, read: true })));
        setLocalUnread(0);
        setUnread(0);
        api.put(API_PATHS.MARK_ALL_READ).catch(load);
    };

    if (loading) return <Loading />;

    return (
        <View style={styles.container}>
            {unread > 0 && (
                <TouchableOpacity style={styles.markAll} onPress={markAll} accessibilityRole="button">
                    <Text style={styles.markAllText}>Mark all {unread} as read</Text>
                </TouchableOpacity>
            )}
            <ErrorNote text={error} />
            <FlatList
                data={items}
                keyExtractor={(item) => item._id}
                contentContainerStyle={{ padding: 12 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
                ListEmptyComponent={<Empty text="You are all caught up." />}
                renderItem={({ item }) => (
                    <TouchableOpacity style={[styles.card, !item.read && styles.unread]} onPress={() => open(item)} accessibilityRole="button">
                        <View style={[styles.dot, { backgroundColor: item.read ? 'transparent' : (TYPE_COLOR[item.type] || colors.primary) }]} />
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.title, !item.read && { fontWeight: '700' }]}>{item.title}</Text>
                            {!!item.message && <Text style={styles.message} numberOfLines={3}>{item.message}</Text>}
                            <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
                        </View>
                    </TouchableOpacity>
                )}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    markAll: { margin: 12, marginBottom: 0, padding: 10, borderRadius: 8, backgroundColor: '#EFF6FF', alignItems: 'center' },
    markAllText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
    card: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border, gap: 10 },
    unread: { borderColor: colors.primary },
    dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
    title: { fontSize: 14, color: colors.text },
    message: { fontSize: 13, color: colors.muted, marginTop: 3 },
    date: { fontSize: 11, color: colors.muted, marginTop: 5 },
});

export default NotificationsScreen;
