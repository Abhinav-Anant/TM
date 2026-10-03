import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import api, { API_PATHS } from '../api';
import { useAuth, canManage } from '../auth';
import TaskRow from '../TaskRow';
import { Field, DateField, ChipRow, Button, Empty, Loading, ErrorNote, Card } from '../ui';
import { MY_WORK_TABS, tabParams, parseDay } from '../lib/logic';
import { colors, PRIORITY_COLOR } from '../theme';

const PAGE = 20;
const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];

/** Task, assignee (managers only), due date, priority: everything else is edited later. */
const QuickAdd = ({ onAdded }) => {
    const { user } = useAuth();
    const [title, setTitle] = useState('');
    const [open, setOpen] = useState(false);
    const [due, setDue] = useState('');
    const [priority, setPriority] = useState('Medium');
    const [assignee, setAssignee] = useState(user?._id);
    const [people, setPeople] = useState([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open || !canManage(user) || people.length) return;
        api.get(API_PATHS.USERS).then(({ data }) => setPeople(data || [])).catch(() => {});
    }, [open, user, people.length]);

    const submit = async () => {
        if (!title.trim() || busy) return;
        const day = parseDay(due);
        if (day === undefined) { setError('Use a date like 2026-10-31.'); return; }
        setBusy(true);
        setError('');
        try {
            await api.post(API_PATHS.TASKS, {
                title: title.trim(), priority, assignedTo: [assignee || user._id],
                dueDate: day ? day.toISOString() : null,
            });
            setTitle(''); setDue('');
            onAdded();
        } catch (e) {
            setError(e.response?.data?.message || 'That did not save.');
        } finally {
            setBusy(false);
        }
    };

    const assignOptions = [{ label: 'Me', value: user?._id }, ...people.filter((p) => p._id !== user?._id).map((p) => ({ label: p.name, value: p._id }))];

    return (
        <Card style={{ marginHorizontal: 12, marginTop: 12 }}>
            <View style={styles.addRow}>
                <Field
                    style={{ flex: 1, marginBottom: 0 }} placeholder="Add a task" value={title}
                    onChangeText={setTitle} onSubmitEditing={submit} returnKeyType="done" accessibilityLabel="New task title"
                />
                <Button title="Add" onPress={submit} busy={busy} disabled={!title.trim()} style={{ marginLeft: 8, paddingHorizontal: 16 }} />
            </View>
            <TouchableOpacity onPress={() => setOpen((o) => !o)}>
                <Text style={styles.more}>{open ? 'Fewer options' : 'Due date, priority, assignee'}</Text>
            </TouchableOpacity>
            {open && (
                <View style={{ marginTop: 10 }}>
                    <DateField label="Due date" value={due} onChange={setDue} />
                    <ChipRow options={PRIORITIES.map((p) => ({ label: p, value: p, color: PRIORITY_COLOR[p] }))} value={priority} onChange={setPriority} />
                    {canManage(user) && <ChipRow style={{ marginTop: 8 }} options={assignOptions} value={assignee} onChange={setAssignee} />}
                </View>
            )}
            <ErrorNote text={error} />
        </Card>
    );
};

const MyWorkScreen = ({ navigation, route }) => {
    const [tab, setTab] = useState('All');
    const [priority, setPriority] = useState('');
    const [project, setProject] = useState('');
    const [projects, setProjects] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState('');
    // Responses can arrive out of order when you tap quickly; only the newest request may write.
    const ticket = useRef(0);

    // Home's tiles open this screen on a particular tab.
    useEffect(() => {
        if (route.params?.tab && MY_WORK_TABS.includes(route.params.tab)) setTab(route.params.tab);
    }, [route.params?.tab]);

    const fetchPage = useCallback(async (wanted, replace) => {
        const mine = ++ticket.current;
        try {
            setError('');
            const { data } = await api.get(API_PATHS.TASKS, {
                params: { mine: 'true', sortBy: 'dueDate', sortOrder: 'asc', page: wanted, limit: PAGE, priority, project, ...tabParams(tab) },
            });
            if (mine !== ticket.current) return;
            setTasks((prev) => (replace ? data.tasks : [...prev, ...data.tasks]));
            setPage(data.pagination.page);
            setPages(data.pagination.pages);
        } catch (e) {
            if (mine === ticket.current) setError(e.response?.data?.message || 'Could not load your tasks. Pull down to try again.');
        } finally {
            if (mine === ticket.current) { setLoading(false); setRefreshing(false); setLoadingMore(false); }
        }
    }, [tab, priority, project]);

    useEffect(() => { setLoading(true); fetchPage(1, true); }, [fetchPage]);
    // Edits made on the detail screen show up when you come back.
    useFocusEffect(useCallback(() => { fetchPage(1, true); }, [fetchPage]));
    useEffect(() => {
        api.get(API_PATHS.PROJECTS, { params: { limit: 100 } }).then(({ data }) => setProjects(data.projects || [])).catch(() => {});
    }, []);

    const loadMore = () => {
        if (loadingMore || loading || page >= pages) return;
        setLoadingMore(true);
        fetchPage(page + 1, false);
    };

    return (
        <View style={styles.container}>
            <QuickAdd onAdded={() => fetchPage(1, true)} />

            <ChipRow style={styles.row} options={MY_WORK_TABS} value={tab} onChange={setTab} />
            <ChipRow
                style={styles.row}
                options={[{ label: 'Any priority', value: '' }, ...PRIORITIES.map((p) => ({ label: p, value: p, color: PRIORITY_COLOR[p] }))]}
                value={priority} onChange={setPriority}
            />
            {projects.length > 0 && (
                <ChipRow style={styles.row} options={[{ label: 'All projects', value: '' }, ...projects.map((p) => ({ label: p.name, value: p._id }))]} value={project} onChange={setProject} />
            )}

            <ErrorNote text={error} />
            {loading ? <Loading /> : (
                <FlatList
                    data={tasks}
                    keyExtractor={(item) => item._id}
                    style={{ flex: 1 }}
                    contentContainerStyle={styles.list}
                    renderItem={({ item }) => <TaskRow task={item} onPress={() => navigation.navigate('TaskDetail', { id: item._id, title: item.title })} />}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchPage(1, true); }} />}
                    onEndReached={loadMore}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ margin: 12 }} /> : null}
                    ListEmptyComponent={<Empty text={tab === 'All' ? 'Nothing is assigned to you yet. Add a task above.' : `Nothing in ${tab.toLowerCase()}.`} />}
                />
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    addRow: { flexDirection: 'row', alignItems: 'center' },
    more: { fontSize: 12, color: colors.primary, marginTop: 10 },
    row: { paddingHorizontal: 12, marginTop: 8 },
    list: { padding: 12, paddingBottom: 32 },
});

export default MyWorkScreen;
