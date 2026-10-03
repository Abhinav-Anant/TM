import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Linking,
    KeyboardAvoidingView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import api, { API_PATHS, BASE_URL, uploadAndAttach } from '../api';
import { useAuth, canManage } from '../auth';
import { Badge, StatusBadge, PriorityBadge, Button, Chip, ChipRow, Card, Section, ProgressBar, Loading, Empty, notify } from '../ui';
import {
    formatMinutes, parseDuration, mentionSuggestions, applyMention, mentionIds, fileLabel, fileId, isImageName,
} from '../lib/logic';
import { colors, formatDate, isOverdue } from '../theme';

const HAND_STATUSES = ['To Do', 'In Progress', 'Blocked', 'Cancelled'];
const NEXT_SUBTASK = { 'To Do': 'In Progress', 'In Progress': 'Completed', Completed: 'To Do' };
const SUBTASK_MARK = { 'To Do': '○', 'In Progress': '◐', Completed: '●' };
const REMINDERS = { none: 'None', at_due: 'At due time', '1h': '1 hour before', '1d': '1 day before' };

const Attachment = ({ link }) => {
    const id = fileId(link);
    const open = async () => {
        try {
            // Our files need a login; the server hands out a 5-minute link a browser can open on its own.
            const url = id ? `${BASE_URL}${(await api.get(API_PATHS.FILE_LINK(id))).data.url}` : link;
            await Linking.openURL(url);
        } catch (e) {
            notify('Could not open the file', e.response?.data?.message);
        }
    };
    return (
        <TouchableOpacity style={styles.attachment} onPress={open} accessibilityRole="link">
            <Text style={styles.attachmentText} numberOfLines={1}>{isImageName(fileLabel(link)) ? '🖼  ' : '📎  '}{fileLabel(link)}</Text>
        </TouchableOpacity>
    );
};

const TaskDetailScreen = ({ route, navigation }) => {
    const { id } = route.params;
    const { user } = useAuth();
    const [task, setTask] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [comment, setComment] = useState('');
    const [posting, setPosting] = useState(false);
    const [newSubtask, setNewSubtask] = useState('');
    const [timeEdit, setTimeEdit] = useState(null); // { estimate, actual } while editing
    const [reviewNote, setReviewNote] = useState('');
    const [uploading, setUploading] = useState(false);

    const load = useCallback(async () => {
        try {
            const { data } = await api.get(API_PATHS.TASK(id));
            setTask(data);
            setError('');
            navigation.setOptions({ title: data.title });
        } catch (e) {
            setError(e.response?.data?.message || 'Could not load this task.');
        }
    }, [id, navigation]);

    useEffect(() => { load(); }, [load]);

    // Managers get an Edit button (the API only lets admin / head change a task's details).
    useEffect(() => {
        if (!canManage(user)) return;
        navigation.setOptions({
            headerRight: () => (
                <TouchableOpacity onPress={() => navigation.navigate('TaskForm', { id })} accessibilityRole="button">
                    <Text style={{ color: colors.primary, fontWeight: '600' }}>Edit</Text>
                </TouchableOpacity>
            ),
        });
    }, [navigation, user, id]);

    /** Runs a server action, then refreshes. Errors become a message, never a stuck spinner. */
    const act = async (request, { reload = true } = {}) => {
        setBusy(true);
        try {
            const res = await request();
            if (reload) await load();
            return res;
        } catch (e) {
            notify('That did not go through', e.response?.data?.message);
            return null;
        } finally {
            setBusy(false);
        }
    };

    const setStatus = (status) => status !== task.status && act(() => api.put(API_PATHS.STATUS(id), { status }));
    const finish = async () => {
        const res = await act(() => api.put(API_PATHS.STATUS(id), { status: 'Completed' }));
        if (res?.data.updatedTask?.status === 'In Review') notify('Submitted for review');
    };
    const review = (action) => act(() => api.put(API_PATHS.REVIEW(id), { action, note: reviewNote })).then(() => setReviewNote(''));

    const toggleTodo = async (index) => {
        const todoChecklist = task.todoChecklist.map((item, i) => (i === index ? { ...item, completed: !item.completed } : item));
        setTask((prev) => ({ ...prev, todoChecklist })); // optimistic
        try {
            await api.put(API_PATHS.TODO(id), { todoChecklist });
            await load();
        } catch (e) {
            notify('Could not update the checklist', e.response?.data?.message);
            load();
        }
    };

    const watch = () => act(async () => {
        const { data } = await api.put(API_PATHS.WATCH(id), { watching: !task.isWatching });
        setTask((prev) => ({ ...prev, isWatching: data.isWatching }));
    }, { reload: false });

    const cycleSubtask = (sub) => act(() => api.put(API_PATHS.SUBTASK(id, sub._id), { status: NEXT_SUBTASK[sub.status] }));
    const addSubtask = async () => {
        if (!newSubtask.trim()) return;
        const res = await act(() => api.post(API_PATHS.SUBTASKS(id), { title: newSubtask.trim() }));
        if (res) setNewSubtask('');
    };

    const saveTime = async () => {
        const estimate = parseDuration(timeEdit.estimate);
        const actual = parseDuration(timeEdit.actual);
        if (Number.isNaN(estimate) || Number.isNaN(actual) || actual === null) {
            notify('Use times like 4h, 1h 30m or 90m');
            return;
        }
        const res = await act(() => api.put(API_PATHS.TIME(id), { estimatedMinutes: estimate, actualMinutes: actual }));
        if (res) setTimeEdit(null);
    };
    const toggleTimer = () => act(() => api.post(task.timerStartedAt ? API_PATHS.TIMER_STOP(id) : API_PATHS.TIMER_START(id)));

    const postComment = async () => {
        const text = comment.trim();
        if (!text || posting) return;
        setPosting(true);
        try {
            const { data } = await api.post(API_PATHS.COMMENTS(id), { text, mentions: mentionIds(text, task.assignedTo || []) });
            setTask((prev) => ({ ...prev, comments: data.comments }));
            setComment('');
        } catch (e) {
            notify('Could not post the comment', e.response?.data?.message);
        } finally {
            setPosting(false);
        }
    };

    // ---- attachments: camera, photo library, any file ----
    const attach = async (asset) => {
        if (!asset) return;
        setUploading(true);
        try {
            const attachments = await uploadAndAttach(id, asset);
            setTask((prev) => ({ ...prev, attachments }));
            load(); // the timeline records it
        } catch (e) {
            notify('Could not add the file', e.response?.data?.message);
        } finally {
            setUploading(false);
        }
    };
    const takePhoto = async () => {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return notify('Camera access is off', 'Allow the camera in your phone settings to take a photo.');
        const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
        if (!res.canceled) attach(res.assets[0]);
    };
    const pickPhoto = async () => {
        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
        if (!res.canceled) attach(res.assets[0]);
    };
    const pickFile = async () => {
        const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
        if (!res.canceled) attach(res.assets[0]);
    };

    if (!task) return error ? <Empty text={error} /> : <Loading />;

    const people = task.assignedTo || [];
    const suggestions = mentionSuggestions(comment, people, user?._id);
    const running = !!task.timerStartedAt;
    const canMarkDone = !['In Review', 'Completed', 'Cancelled'].includes(task.status);
    const dueToday = task.dueDate && !isOverdue(task);

    return (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.title}>{task.title}</Text>
                <View style={styles.row}>
                    <StatusBadge status={task.status} />
                    <PriorityBadge priority={task.priority} />
                    <Badge label={task.category || 'General'} />
                    {task.recurrence && task.recurrence !== 'none' && <Badge label={`Repeats ${task.recurrence}`} />}
                </View>

                {(task.project || task.department) && (
                    <Text style={styles.meta}>
                        {task.project ? `Project: ${task.project.name}` : ''}{task.project && task.department ? '  ·  ' : ''}{task.department ? `Department: ${task.department.name}` : ''}
                    </Text>
                )}

                {task.waitingFor?.length > 0 && (
                    <View style={styles.blocked} accessibilityRole="alert"><Text style={styles.blockedText}>Blocked. Waiting for {task.waitingFor.join(', ')}</Text></View>
                )}

                {!!task.description && <Text style={styles.description}>{task.description}</Text>}
                {task.tags?.length > 0 && <Text style={styles.tags}>{task.tags.map((t) => `#${t}`).join('  ')}</Text>}

                <Text style={[styles.meta, isOverdue(task) && styles.overdue]}>
                    {task.dueDate ? `${isOverdue(task) ? 'Overdue - due ' : 'Due '}${formatDate(task.dueDate)}` : 'No due date'}
                    {dueToday && task.reminder?.type && task.reminder.type !== 'none' ? `  ·  Reminder: ${REMINDERS[task.reminder.type] || `${formatMinutes(task.reminder.customMinutes)} before`}` : ''}
                </Text>
                <Text style={styles.meta}>Assigned to {people.map((p) => p.name).join(', ') || 'nobody'}</Text>

                <View style={{ marginTop: 12 }}><ProgressBar value={task.progress || 0} /></View>
                <Text style={styles.meta}>{task.progress || 0}% complete</Text>

                {/* ---- status ---- */}
                <Section title="Status">
                    {canMarkDone && (
                        <Button
                            title={task.requiresReview && !task.canReview ? 'Submit for review' : 'Mark as done'}
                            onPress={finish} busy={busy} style={{ marginBottom: 10 }}
                        />
                    )}
                    {task.status === 'In Review' && task.canReview && (
                        <Card>
                            <Text style={styles.cardTitle}>Waiting for your review</Text>
                            <TextInput style={styles.input} placeholder="Note for the assignee (sent with Send back)" value={reviewNote} onChangeText={setReviewNote} multiline />
                            <View style={styles.row}>
                                <Button title="Approve" onPress={() => review('approve')} busy={busy} style={{ flex: 1 }} />
                                <Button title="Send back" kind="secondary" onPress={() => review('reject')} busy={busy} style={{ flex: 1 }} />
                            </View>
                        </Card>
                    )}
                    {task.status === 'In Review' && !task.canReview && <Text style={styles.meta}>Submitted. Waiting for approval.</Text>}
                    {HAND_STATUSES.includes(task.status) && (
                        <ChipRow options={HAND_STATUSES} value={task.status} onChange={setStatus} />
                    )}
                    <TouchableOpacity onPress={watch} style={{ marginTop: 10 }}>
                        <Text style={styles.link}>{task.isWatching ? 'Unfollow this task' : 'Follow this task'}</Text>
                    </TouchableOpacity>
                </Section>

                {/* ---- time ---- */}
                <Section title="Time" right={!timeEdit && <TouchableOpacity onPress={() => setTimeEdit({ estimate: task.estimatedMinutes ? formatMinutes(task.estimatedMinutes) : '', actual: formatMinutes(task.actualMinutes || 0) })}><Text style={styles.link}>Edit</Text></TouchableOpacity>}>
                    {timeEdit ? (
                        <Card>
                            <TextInput style={styles.input} placeholder="Estimated, e.g. 4h" value={timeEdit.estimate} onChangeText={(v) => setTimeEdit((t) => ({ ...t, estimate: v }))} />
                            <TextInput style={styles.input} placeholder="Time spent, e.g. 3h 25m" value={timeEdit.actual} onChangeText={(v) => setTimeEdit((t) => ({ ...t, actual: v }))} />
                            <View style={styles.row}>
                                <Button title="Save" onPress={saveTime} busy={busy} style={{ flex: 1 }} />
                                <Button title="Cancel" kind="secondary" onPress={() => setTimeEdit(null)} style={{ flex: 1 }} />
                            </View>
                        </Card>
                    ) : (
                        <>
                            <Text style={styles.body}>
                                {task.estimatedMinutes ? `Estimated: ${formatMinutes(task.estimatedMinutes)}   ` : ''}Actual: {formatMinutes(task.actualMinutes || 0)}{running ? '  (timer running)' : ''}
                            </Text>
                            {(!running || String(task.timerBy?._id || task.timerBy) === String(user?._id) || user?.role === 'admin') && (
                                <Button title={running ? 'Stop timer' : 'Start timer'} kind="secondary" onPress={toggleTimer} busy={busy} style={{ marginTop: 8, alignSelf: 'flex-start' }} />
                            )}
                        </>
                    )}
                </Section>

                {/* ---- checklist ---- */}
                <Section title="Checklist">
                    {task.todoChecklist?.map((item, index) => (
                        <TouchableOpacity key={item._id || index} style={styles.todoRow} onPress={() => toggleTodo(index)} accessibilityRole="checkbox" accessibilityState={{ checked: item.completed }}>
                            <View style={[styles.checkbox, item.completed && styles.checkboxOn]}>{item.completed && <Text style={styles.checkmark}>✓</Text>}</View>
                            <Text style={[styles.todoText, item.completed && styles.todoDone]}>{item.text}</Text>
                        </TouchableOpacity>
                    ))}
                    {!task.todoChecklist?.length && <Text style={styles.meta}>No checklist on this task.</Text>}
                </Section>

                {/* ---- subtasks ---- */}
                <Section title={`Subtasks (${task.subtasks.filter((s) => s.status === 'Completed').length}/${task.subtasks.length})`}>
                    {task.subtasks.map((sub) => (
                        <TouchableOpacity key={sub._id} style={styles.todoRow} onPress={() => cycleSubtask(sub)} accessibilityRole="button" accessibilityLabel={`${sub.title}: ${sub.status}. Tap to change`}>
                            <Text style={[styles.subMark, sub.status === 'Completed' && { color: colors.primary }]}>{SUBTASK_MARK[sub.status]}</Text>
                            <Text style={[styles.todoText, sub.status === 'Completed' && styles.todoDone]}>{sub.title}{sub.assignee ? `  · ${sub.assignee.name}` : ''}</Text>
                        </TouchableOpacity>
                    ))}
                    <View style={[styles.row, { alignItems: 'center', marginTop: 6 }]}>
                        <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="Add a subtask" value={newSubtask} onChangeText={setNewSubtask} onSubmitEditing={addSubtask} />
                        <Button title="Add" kind="secondary" onPress={addSubtask} disabled={!newSubtask.trim()} />
                    </View>
                </Section>

                {task.blockedBy?.length > 0 && (
                    <Section title="Blocked by">
                        {task.blockedBy.map((b) => <Text key={b._id} style={styles.body}>• {b.title} <Text style={styles.meta}>({b.status})</Text></Text>)}
                    </Section>
                )}

                {/* ---- attachments ---- */}
                <Section title="Attachments">
                    {(task.attachments || []).map((link, index) => <Attachment key={`${link}${index}`} link={link} />)}
                    {!task.attachments?.length && <Text style={styles.meta}>No files yet.</Text>}
                    <View style={[styles.row, { marginTop: 8 }]}>
                        <Chip label={uploading ? 'Uploading…' : '📷 Camera'} onPress={takePhoto} disabled={uploading} />
                        <Chip label="🖼 Photos" onPress={pickPhoto} disabled={uploading} />
                        <Chip label="📎 File" onPress={pickFile} disabled={uploading} />
                    </View>
                </Section>

                {/* ---- comments ---- */}
                <Section title={`Comments (${task.comments?.length || 0})`}>
                    {(task.comments || []).map((c) => (
                        <View key={c._id} style={styles.comment}>
                            <Text style={styles.commentAuthor}>{c.user?.name || 'Unknown'}</Text>
                            <Text style={styles.commentText}>{c.text}</Text>
                            <Text style={styles.commentDate}>{formatDate(c.createdAt)}</Text>
                        </View>
                    ))}
                    {!task.comments?.length && <Text style={styles.meta}>No comments yet.</Text>}

                    {suggestions.length > 0 && (
                        <View style={styles.row}>{suggestions.map((p) => <Chip key={p._id} label={`@${p.name}`} onPress={() => setComment(applyMention(comment, p))} />)}</View>
                    )}
                    <View style={styles.commentBox}>
                        <TextInput
                            style={styles.commentInput} placeholder="Write a comment… type @ to mention" value={comment}
                            onChangeText={setComment} multiline maxLength={2000} accessibilityLabel="Write a comment"
                        />
                        <Button title={posting ? '…' : 'Post'} onPress={postComment} disabled={!comment.trim() || posting} />
                    </View>
                </Section>

                {/* ---- timeline ---- */}
                <Section title="Activity">
                    {[...(task.activity || [])].reverse().slice(0, 30).map((a, i) => (
                        <Text key={`${a.at}${i}`} style={styles.activity}>
                            <Text style={{ fontWeight: '600', color: colors.text }}>{a.user?.name || 'Someone'}</Text> {a.text}
                            <Text style={styles.meta}>  {formatDate(a.at)}</Text>
                        </Text>
                    ))}
                </Section>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    title: { fontSize: 20, fontWeight: '700', color: colors.text },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    description: { fontSize: 14, color: colors.muted, marginTop: 12, lineHeight: 20 },
    tags: { fontSize: 13, color: colors.muted, marginTop: 8 },
    body: { fontSize: 14, color: colors.text, marginTop: 4 },
    meta: { fontSize: 12, color: colors.muted, marginTop: 8 },
    overdue: { color: colors.danger, fontWeight: '600' },
    link: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    blocked: { backgroundColor: '#FEE2E2', borderRadius: 8, padding: 10, marginTop: 12 },
    blockedText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
    cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 8 },
    input: {
        backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 8,
        paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 8, color: colors.text,
    },
    todoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border, marginRight: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
    checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },
    subMark: { width: 24, fontSize: 18, color: colors.muted },
    todoText: { flex: 1, fontSize: 14, color: colors.text },
    todoDone: { textDecorationLine: 'line-through', color: colors.muted },
    attachment: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginBottom: 8 },
    attachmentText: { fontSize: 13, color: colors.primary },
    comment: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginBottom: 8 },
    commentAuthor: { fontSize: 13, fontWeight: '600', color: colors.text },
    commentText: { fontSize: 13, color: colors.text, marginTop: 3 },
    commentDate: { fontSize: 11, color: colors.muted, marginTop: 4 },
    commentBox: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8 },
    commentInput: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, maxHeight: 120, color: colors.text },
    activity: { fontSize: 12, color: colors.muted, marginBottom: 6, lineHeight: 17 },
});

export default TaskDetailScreen;
