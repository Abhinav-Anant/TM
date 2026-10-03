import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, RefreshControl, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import api, { API_PATHS } from '../api';
import { Card, Badge, ChipRow, ProgressBar, Empty, Loading, ErrorNote } from '../ui';
import { colors, formatDate } from '../theme';

const PAGE = 15;
const STATUSES = [{ label: 'All', value: '' }, ...['Planning', 'Active', 'On Hold', 'Completed', 'Cancelled'].map((s) => ({ label: s, value: s }))];
const STATUS_COLOR = { Planning: '#8D51FF', Active: '#00B8DB', 'On Hold': '#F59E0B', Completed: '#65A30D', Cancelled: '#6B7280' };

export const ProjectStats = ({ stats }) => (
    <View style={styles.stats}>
        {[['Total', stats.total], ['Done', stats.completed], ['Overdue', stats.overdue], ['Blocked', stats.blocked], ['Due soon', stats.dueSoon]].map(([label, value]) => (
            <View key={label} style={{ alignItems: 'center', flex: 1 }}>
                <Text style={[styles.statValue, (label === 'Overdue' || label === 'Blocked') && value > 0 && { color: colors.danger }]}>{value}</Text>
                <Text style={styles.statLabel}>{label}</Text>
            </View>
        ))}
    </View>
);

const ProjectsScreen = ({ navigation }) => {
    const [status, setStatus] = useState('');
    const [projects, setProjects] = useState([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState('');
    const ticket = useRef(0);

    const fetchPage = useCallback(async (wanted, replace) => {
        const mine = ++ticket.current;
        try {
            setError('');
            const { data } = await api.get(API_PATHS.PROJECTS, { params: { status, page: wanted, limit: PAGE } });
            if (mine !== ticket.current) return;
            setProjects((prev) => (replace ? data.projects : [...prev, ...data.projects]));
            setPage(data.pagination.page);
            setPages(data.pagination.pages);
        } catch (e) {
            if (mine === ticket.current) setError(e.response?.data?.message || 'Could not load projects. Pull down to try again.');
        } finally {
            if (mine === ticket.current) { setLoading(false); setRefreshing(false); setLoadingMore(false); }
        }
    }, [status]);

    useEffect(() => { setLoading(true); fetchPage(1, true); }, [fetchPage]);
    useFocusEffect(useCallback(() => { fetchPage(1, true); }, [fetchPage]));

    return (
        <View style={styles.container}>
            <ChipRow style={{ paddingHorizontal: 12, marginTop: 12 }} options={STATUSES} value={status} onChange={setStatus} />
            <ErrorNote text={error} />
            {loading ? <Loading /> : (
                <FlatList
                    data={projects}
                    keyExtractor={(p) => p._id}
                    contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchPage(1, true); }} />}
                    onEndReached={() => { if (!loadingMore && page < pages) { setLoadingMore(true); fetchPage(page + 1, false); } }}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ margin: 12 }} /> : null}
                    ListEmptyComponent={<Empty text={status ? `No ${status.toLowerCase()} projects.` : 'No projects yet. Create them on the web app.'} />}
                    renderItem={({ item: p }) => (
                        <Card onPress={() => navigation.navigate('ProjectDetail', { id: p._id, title: p.name })}>
                            <View style={styles.head}>
                                <Text style={styles.name} numberOfLines={2}>{p.name}</Text>
                                <Badge label={p.status} color={STATUS_COLOR[p.status]} />
                            </View>
                            <Text style={styles.meta}>{p.manager ? `Managed by ${p.manager.name}` : 'No manager'}{p.department ? ` · ${p.department.name}` : ''}</Text>
                            <View style={{ marginTop: 10 }}><ProgressBar value={p.stats.progress} color={STATUS_COLOR[p.status]} /></View>
                            <Text style={[styles.meta, { textAlign: 'right' }]}>{p.stats.progress}%</Text>
                            <ProjectStats stats={p.stats} />
                            {!!p.dueDate && <Text style={styles.meta}>Due {formatDate(p.dueDate)}</Text>}
                        </Card>
                    )}
                />
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
    name: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
    meta: { fontSize: 12, color: colors.muted, marginTop: 6 },
    stats: { flexDirection: 'row', marginTop: 10 },
    statValue: { fontSize: 18, fontWeight: '700', color: colors.text },
    statLabel: { fontSize: 10, color: colors.muted },
});


export default ProjectsScreen;
