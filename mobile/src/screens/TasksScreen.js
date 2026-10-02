import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet,
    ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import api, { API_PATHS } from '../api';
import { colors, STATUS_COLOR, PRIORITY_COLOR, formatDate, isOverdue } from '../theme';

const STATUS_TABS = ['All', 'To Do', 'In Progress', 'Blocked', 'In Review', 'Completed', 'Cancelled'];
const PRIORITIES = ['Any', 'Urgent', 'High', 'Medium', 'Low'];
const SEARCH_DEBOUNCE_MS = 350;

const Chip = ({ label, active, onPress, color }) => (
    <TouchableOpacity
        style={[styles.chip, active && { backgroundColor: color || colors.primary, borderColor: color || colors.primary }]}
        onPress={onPress}
    >
        <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
);

const TaskRow = ({ task, onPress }) => (
    <TouchableOpacity style={styles.card} onPress={onPress}>
        <View style={styles.cardHeader}>
            <View style={[styles.badge, { backgroundColor: `${STATUS_COLOR[task.status] || colors.muted}22` }]}>
                <Text style={[styles.badgeText, { color: STATUS_COLOR[task.status] || colors.muted }]}>{task.status}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: `${PRIORITY_COLOR[task.priority] || colors.muted}22` }]}>
                <Text style={[styles.badgeText, { color: PRIORITY_COLOR[task.priority] || colors.muted }]}>{task.priority}</Text>
            </View>
            {!!task.category && (
                <View style={styles.badgeNeutral}>
                    <Text style={styles.badgeNeutralText}>{task.category}</Text>
                </View>
            )}
        </View>

        <Text style={styles.cardTitle} numberOfLines={2}>{task.title}</Text>
        {!!task.description && <Text style={styles.cardDesc} numberOfLines={2}>{task.description}</Text>}

        <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${task.progress || 0}%` }]} />
        </View>

        <View style={styles.cardFooter}>
            <Text style={[styles.meta, isOverdue(task) && styles.metaOverdue]}>
                {isOverdue(task) ? 'Overdue - ' : 'Due '}{formatDate(task.dueDate)}
            </Text>
            <Text style={styles.meta}>
                {task.completedTodoCount || 0}/{task.todoChecklist?.length || 0} done
                {task.comments?.length ? `  ${task.comments.length} comments` : ''}
            </Text>
        </View>
    </TouchableOpacity>
);

const TasksScreen = ({ navigation }) => {
    const [tasks, setTasks] = useState([]);
    const [categories, setCategories] = useState([]);
    const [status, setStatus] = useState('All');
    const [priority, setPriority] = useState('Any');
    const [category, setCategory] = useState('All');
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Debounce typing so each keystroke is not a request.
    useEffect(() => {
        const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [searchInput]);

    const load = useCallback(async () => {
        try {
            const { data } = await api.get(API_PATHS.TASKS, {
                params: {
                    status: status === 'All' ? '' : status,
                    priority: priority === 'Any' ? '' : priority,
                    category: category === 'All' ? '' : category,
                    search,
                    limit: 100, // ponytail: no paging on mobile yet; infinite scroll in the mobile phase
                    sortBy: 'dueDate',
                    sortOrder: 'asc',
                },
            });
            setTasks(data?.tasks || []);
        } catch (error) {
            console.warn('Failed to load tasks', error.message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [status, priority, category, search]);

    useEffect(() => { load(); }, [load]);

    // Refresh whenever the screen regains focus, so edits made in the detail view show up.
    useEffect(() => navigation.addListener('focus', load), [navigation, load]);

    useEffect(() => {
        api.get(API_PATHS.CATEGORIES)
            .then(({ data }) => setCategories(data?.categories || []))
            .catch(() => setCategories([]));
    }, []);

    return (
        <View style={styles.container}>
            <TextInput
                style={styles.search}
                placeholder="Search title or description"
                value={searchInput}
                onChangeText={setSearchInput}
                clearButtonMode="while-editing"
            />

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
                {STATUS_TABS.map((tab) => (
                    <Chip key={tab} label={tab} active={status === tab} onPress={() => setStatus(tab)} />
                ))}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
                {PRIORITIES.map((p) => (
                    <Chip
                        key={p}
                        label={p === 'Any' ? 'Any priority' : p}
                        active={priority === p}
                        color={PRIORITY_COLOR[p]}
                        onPress={() => setPriority(p)}
                    />
                ))}
                {['All', ...categories].map((c) => (
                    <Chip key={`cat_${c}`} label={c} active={category === c} onPress={() => setCategory(c)} />
                ))}
            </ScrollView>

            {loading ? (
                <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
            ) : (
                <FlatList
                    data={tasks}
                    keyExtractor={(item) => item._id}
                    contentContainerStyle={styles.list}
                    renderItem={({ item }) => (
                        <TaskRow task={item} onPress={() => navigation.navigate('TaskDetail', { id: item._id, title: item.title })} />
                    )}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
                    }
                    ListEmptyComponent={<Text style={styles.empty}>No tasks match these filters.</Text>}
                />
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    search: {
        backgroundColor: colors.card, margin: 12, marginBottom: 8, borderRadius: 10,
        borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15,
    },
    filterRow: { paddingHorizontal: 8, flexGrow: 0, marginBottom: 4 },
    chip: {
        borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginHorizontal: 4, marginVertical: 2,
    },
    chipText: { fontSize: 12, color: colors.muted },
    chipTextActive: { color: '#fff', fontWeight: '600' },
    list: { padding: 12, paddingBottom: 32 },
    card: {
        backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10,
        borderWidth: 1, borderColor: colors.border,
    },
    cardHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    badgeText: { fontSize: 11, fontWeight: '600' },
    badgeNeutral: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#F1F5F9' },
    badgeNeutralText: { fontSize: 11, color: colors.muted, fontWeight: '600' },
    cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
    cardDesc: { fontSize: 13, color: colors.muted, marginTop: 4 },
    progressTrack: { height: 5, backgroundColor: '#EEF0F5', borderRadius: 3, marginTop: 10, overflow: 'hidden' },
    progressFill: { height: 5, backgroundColor: colors.primary, borderRadius: 3 },
    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
    meta: { fontSize: 11, color: colors.muted },
    metaOverdue: { color: colors.danger, fontWeight: '600' },
    empty: { textAlign: 'center', color: colors.muted, marginTop: 40 },
});

export default TasksScreen;
