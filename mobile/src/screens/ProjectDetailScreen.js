import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, RefreshControl, StyleSheet, ActivityIndicator } from 'react-native';
import api, { API_PATHS } from '../api';
import TaskRow from '../TaskRow';
import { ProjectStats } from './ProjectsScreen';
import { Badge, PriorityBadge, ProgressBar, Empty, Loading, ErrorNote } from '../ui';
import { colors, formatDate } from '../theme';

const PAGE = 15;

const ProjectDetailScreen = ({ route, navigation }) => {
    const { id } = route.params;
    const [project, setProject] = useState(null);
    const [tasks, setTasks] = useState([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState('');
    const ticket = useRef(0);

    const loadProject = useCallback(async () => {
        try {
            const { data } = await api.get(API_PATHS.PROJECT(id));
            setProject(data);
            navigation.setOptions({ title: data.name });
        } catch (e) {
            setError(e.response?.status === 404 ? 'That project does not exist, or you do not have access.' : 'Could not load this project.');
        }
    }, [id, navigation]);

    const fetchTasks = useCallback(async (wanted, replace) => {
        const mine = ++ticket.current;
        try {
            const { data } = await api.get(API_PATHS.TASKS, { params: { project: id, sortBy: 'dueDate', sortOrder: 'asc', page: wanted, limit: PAGE } });
            if (mine !== ticket.current) return;
            setTasks((prev) => (replace ? data.tasks : [...prev, ...data.tasks]));
            setPage(data.pagination.page);
            setPages(data.pagination.pages);
        } catch {
            if (mine === ticket.current) setError('Could not load the tasks.');
        } finally {
            if (mine === ticket.current) { setRefreshing(false); setLoadingMore(false); }
        }
    }, [id]);

    useEffect(() => { loadProject(); fetchTasks(1, true); }, [loadProject, fetchTasks]);
    useEffect(() => navigation.addListener('focus', () => { loadProject(); fetchTasks(1, true); }), [navigation, loadProject, fetchTasks]);

    if (!project) return error ? <Empty text={error} /> : <Loading />;

    const header = (
        <View style={{ marginBottom: 8 }}>
            <View style={styles.row}>
                <Badge label={project.status} color={colors.primary} />
                <PriorityBadge priority={project.priority} />
            </View>
            {!!project.description && <Text style={styles.description}>{project.description}</Text>}
            <View style={{ marginTop: 12 }}><ProgressBar value={project.stats.progress} /></View>
            <Text style={styles.progress}>{project.stats.progress}% · {project.stats.completed} of {project.stats.total} tasks done</Text>
            <ProjectStats stats={project.stats} />
            <Text style={styles.meta}>Manager: {project.manager?.name || 'None'}{project.department ? `  ·  ${project.department.name}` : ''}</Text>
            <Text style={styles.meta}>{project.startDate ? `Start ${formatDate(project.startDate)}   ` : ''}{project.dueDate ? `Due ${formatDate(project.dueDate)}` : ''}</Text>
            {project.members?.length > 0 && <Text style={styles.meta}>Members: {project.members.map((m) => m.name).join(', ')}</Text>}
            <Text style={styles.tasksTitle}>Tasks</Text>
            <ErrorNote text={error} />
        </View>
    );

    return (
        <FlatList
            style={{ backgroundColor: colors.bg }}
            contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
            data={tasks}
            keyExtractor={(t) => t._id}
            ListHeaderComponent={header}
            renderItem={({ item }) => <TaskRow task={item} onPress={() => navigation.navigate('TaskDetail', { id: item._id, title: item.title })} />}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadProject(); fetchTasks(1, true); }} />}
            onEndReached={() => { if (!loadingMore && page < pages) { setLoadingMore(true); fetchTasks(page + 1, false); } }}
            onEndReachedThreshold={0.4}
            ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ margin: 12 }} /> : null}
            ListEmptyComponent={<Empty text="No tasks you can see in this project yet." />}
        />
    );
};

const styles = StyleSheet.create({
    row: { flexDirection: 'row', gap: 8 },
    description: { fontSize: 14, color: colors.muted, marginTop: 12, lineHeight: 20 },
    progress: { fontSize: 12, color: colors.muted, marginTop: 6 },
    meta: { fontSize: 12, color: colors.muted, marginTop: 6 },
    tasksTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 20 },
});

export default ProjectDetailScreen;
