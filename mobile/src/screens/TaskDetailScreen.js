import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
    ActivityIndicator, Linking, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import api, { API_PATHS } from '../api';
import { colors, STATUS_COLOR, PRIORITY_COLOR, formatDate, isOverdue } from '../theme';

const TaskDetailScreen = ({ route }) => {
    const { id } = route.params;
    const [task, setTask] = useState(null);
    const [comment, setComment] = useState('');
    const [posting, setPosting] = useState(false);

    const load = useCallback(async () => {
        try {
            const { data } = await api.get(API_PATHS.TASK(id));
            setTask(data);
        } catch (error) {
            Alert.alert('Error', error.response?.data?.message || 'Failed to load task');
        }
    }, [id]);

    useEffect(() => { load(); }, [load]);

    const toggleTodo = async (index) => {
        const todoChecklist = task.todoChecklist.map((item, i) =>
            i === index ? { ...item, completed: !item.completed } : item
        );

        // Optimistic - the server response replaces it either way.
        setTask((prev) => ({ ...prev, todoChecklist }));

        try {
            const { data } = await api.put(API_PATHS.TODO(id), { todoChecklist });
            setTask(data.task);
        } catch (error) {
            Alert.alert('Error', error.response?.data?.message || 'Could not update the checklist');
            load();
        }
    };

    const postComment = async () => {
        const text = comment.trim();
        if (!text || posting) return;

        setPosting(true);
        try {
            const { data } = await api.post(API_PATHS.COMMENTS(id), { text });
            setTask((prev) => ({ ...prev, comments: data.comments }));
            setComment('');
        } catch (error) {
            Alert.alert('Error', error.response?.data?.message || 'Failed to post comment');
        } finally {
            setPosting(false);
        }
    };

    if (!task) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />;

    return (
        <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={90}
        >
            <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
                <Text style={styles.title}>{task.title}</Text>

                <View style={styles.row}>
                    <View style={[styles.badge, { backgroundColor: `${STATUS_COLOR[task.status]}22` }]}>
                        <Text style={[styles.badgeText, { color: STATUS_COLOR[task.status] }]}>{task.status}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: `${PRIORITY_COLOR[task.priority]}22` }]}>
                        <Text style={[styles.badgeText, { color: PRIORITY_COLOR[task.priority] }]}>{task.priority}</Text>
                    </View>
                    <View style={styles.badgeNeutral}>
                        <Text style={styles.badgeNeutralText}>{task.category || 'General'}</Text>
                    </View>
                </View>

                {!!task.description && <Text style={styles.description}>{task.description}</Text>}

                <Text style={[styles.meta, isOverdue(task) && styles.metaOverdue]}>
                    {isOverdue(task) ? 'Overdue - due ' : 'Due '}{formatDate(task.dueDate)}
                </Text>

                <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${task.progress || 0}%` }]} />
                </View>
                <Text style={styles.meta}>{task.progress || 0}% complete</Text>

                <Text style={styles.sectionTitle}>Checklist</Text>
                {task.todoChecklist?.map((item, index) => (
                    <TouchableOpacity key={item._id || index} style={styles.todoRow} onPress={() => toggleTodo(index)}>
                        <View style={[styles.checkbox, item.completed && styles.checkboxOn]}>
                            {item.completed && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={[styles.todoText, item.completed && styles.todoDone]}>{item.text}</Text>
                    </TouchableOpacity>
                ))}

                {task.attachments?.length > 0 && (
                    <>
                        <Text style={styles.sectionTitle}>Attachments</Text>
                        {task.attachments.map((link, index) => (
                            <TouchableOpacity key={index} style={styles.attachment} onPress={() => Linking.openURL(link)}>
                                <Text style={styles.attachmentText} numberOfLines={1}>
                                    {decodeURIComponent(link.split('/').pop() || link).replace(/^\d{10,}-/, '')}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </>
                )}

                <Text style={styles.sectionTitle}>Comments ({task.comments?.length || 0})</Text>
                {(task.comments || []).map((c) => (
                    <View key={c._id} style={styles.comment}>
                        <Text style={styles.commentAuthor}>{c.user?.name || 'Unknown'}</Text>
                        <Text style={styles.commentText}>{c.text}</Text>
                        <Text style={styles.commentDate}>{formatDate(c.createdAt)}</Text>
                    </View>
                ))}
                {(task.comments || []).length === 0 && (
                    <Text style={styles.meta}>No comments yet.</Text>
                )}

                <View style={styles.commentBox}>
                    <TextInput
                        style={styles.commentInput}
                        placeholder="Write a comment..."
                        value={comment}
                        onChangeText={setComment}
                        multiline
                        maxLength={2000}
                    />
                    <TouchableOpacity
                        style={[styles.sendButton, (!comment.trim() || posting) && { opacity: 0.4 }]}
                        onPress={postComment}
                        disabled={!comment.trim() || posting}
                    >
                        <Text style={styles.sendText}>{posting ? '...' : 'Post'}</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    title: { fontSize: 20, fontWeight: '700', color: colors.text },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    badgeText: { fontSize: 11, fontWeight: '600' },
    badgeNeutral: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#F1F5F9' },
    badgeNeutralText: { fontSize: 11, color: colors.muted, fontWeight: '600' },
    description: { fontSize: 14, color: colors.muted, marginTop: 12, lineHeight: 20 },
    meta: { fontSize: 12, color: colors.muted, marginTop: 8 },
    metaOverdue: { color: colors.danger, fontWeight: '600' },
    progressTrack: { height: 6, backgroundColor: '#EEF0F5', borderRadius: 3, marginTop: 12, overflow: 'hidden' },
    progressFill: { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 22, marginBottom: 8 },
    todoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    checkbox: {
        width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border,
        marginRight: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
    },
    checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },
    todoText: { flex: 1, fontSize: 14, color: colors.text },
    todoDone: { textDecorationLine: 'line-through', color: colors.muted },
    attachment: {
        backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: 8, padding: 10, marginBottom: 8,
    },
    attachmentText: { fontSize: 13, color: colors.primary },
    comment: {
        backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: 8, padding: 10, marginBottom: 8,
    },
    commentAuthor: { fontSize: 13, fontWeight: '600', color: colors.text },
    commentText: { fontSize: 13, color: colors.text, marginTop: 3 },
    commentDate: { fontSize: 11, color: colors.muted, marginTop: 4 },
    commentBox: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 12 },
    commentInput: {
        flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, maxHeight: 120,
    },
    sendButton: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 18, paddingVertical: 12 },
    sendText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});

export default TaskDetailScreen;
