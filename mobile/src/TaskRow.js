import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, StatusBadge, PriorityBadge, ProgressBar } from './ui';
import { colors, formatDate, isOverdue } from './theme';

/** One task in a list: what it is, where it stands, when it is due. */
const TaskRow = ({ task, onPress }) => (
    <Card onPress={onPress}>
        <View style={styles.badges}>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {!!task.project?.name && <Text style={styles.project} numberOfLines={1}>{task.project.name}</Text>}
        </View>

        <Text style={styles.title} numberOfLines={2}>{task.title}</Text>

        {task.waitingFor?.length > 0 && (
            <Text style={styles.waiting} numberOfLines={1}>Waiting for {task.waitingFor.join(', ')}</Text>
        )}
        {task.tags?.length > 0 && (
            <Text style={styles.tags} numberOfLines={1}>{task.tags.map((t) => `#${t}`).join('  ')}</Text>
        )}

        <View style={{ marginTop: 10 }}><ProgressBar value={task.progress || 0} /></View>

        <View style={styles.footer}>
            <Text style={[styles.meta, isOverdue(task) && styles.overdue]}>
                {task.dueDate ? `${isOverdue(task) ? 'Overdue - ' : 'Due '}${formatDate(task.dueDate)}` : 'No due date'}
            </Text>
            <Text style={styles.meta}>
                {task.completedTodoCount || 0}/{task.todoChecklist?.length || 0} done
                {task.comments?.length ? `  ${task.comments.length} comments` : ''}
            </Text>
        </View>
    </Card>
);

const styles = StyleSheet.create({
    badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 8 },
    project: { fontSize: 11, color: colors.muted, flexShrink: 1 },
    title: { fontSize: 16, fontWeight: '600', color: colors.text },
    waiting: { fontSize: 12, color: colors.danger, marginTop: 4 },
    tags: { fontSize: 12, color: colors.muted, marginTop: 4 },
    footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
    meta: { fontSize: 11, color: colors.muted },
    overdue: { color: colors.danger, fontWeight: '600' },
});

export default TaskRow;
