import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import api, { API_PATHS } from '../api';
import { useAuth, canManage } from '../auth';
import { Field, DateField, ChipRow, Chip, Button, Loading, ErrorNote, notify } from '../ui';
import { parseDay, toDayText, parseDuration, formatMinutes } from '../lib/logic';
import { colors, PRIORITY_COLOR } from '../theme';

const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'].map((p) => ({ label: p, value: p, color: PRIORITY_COLOR[p] }));
const REMINDERS = [['None', 'none'], ['At due time', 'at_due'], ['1 hour before', '1h'], ['1 day before', '1d']].map(([label, value]) => ({ label, value }));

/**
 * Create a task (anyone: members can only assign to themselves) or edit one (admin / head, as the API allows).
 * Only the title and an assignee are required.
 */
const TaskFormScreen = ({ route, navigation }) => {
    const id = route.params?.id;
    const { user } = useAuth();
    const manager = canManage(user);
    const [loading, setLoading] = useState(!!id);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [errors, setErrors] = useState({});

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState('Medium');
    const [status, setStatus] = useState('To Do');
    const [assignees, setAssignees] = useState([user?._id]);
    const [due, setDue] = useState('');
    const [project, setProject] = useState('');
    const [tagsText, setTagsText] = useState('');
    const [reminder, setReminder] = useState('none');
    const [estimate, setEstimate] = useState('');
    const [checklist, setChecklist] = useState([]); // [{ text, completed }]
    const [newItem, setNewItem] = useState('');
    const [people, setPeople] = useState([]);
    const [projects, setProjects] = useState([]);

    useEffect(() => {
        navigation.setOptions({ title: id ? 'Edit task' : 'New task' });
        api.get(API_PATHS.PROJECTS, { params: { limit: 100 } }).then(({ data }) => setProjects(data.projects || [])).catch(() => {});
        if (manager) api.get(API_PATHS.USERS).then(({ data }) => setPeople(data || [])).catch(() => {});
    }, [id, manager, navigation]);

    useEffect(() => {
        if (!id) return;
        (async () => {
            try {
                const { data } = await api.get(API_PATHS.TASK(id));
                setTitle(data.title);
                setDescription(data.description || '');
                setPriority(data.priority);
                setStatus(data.status);
                setAssignees((data.assignedTo || []).map((u) => u._id));
                setDue(data.dueDate ? toDayText(new Date(data.dueDate)) : '');
                setProject(data.project?._id || '');
                setTagsText((data.tags || []).map((t) => `#${t}`).join(' '));
                setReminder(['none', 'at_due', '1h', '1d'].includes(data.reminder?.type) ? data.reminder.type : 'none');
                setEstimate(data.estimatedMinutes ? formatMinutes(data.estimatedMinutes) : '');
                setChecklist((data.todoChecklist || []).map((t) => ({ text: t.text, completed: t.completed })));
            } catch (e) {
                setError(e.response?.data?.message || 'Could not load this task.');
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    const toggleAssignee = (uid) => setAssignees((cur) => (cur.includes(uid) ? cur.filter((x) => x !== uid) : [...cur, uid]));

    const submit = async () => {
        const found = {};
        const day = parseDay(due);
        const minutes = parseDuration(estimate);
        if (!title.trim()) found.title = 'Give the task a title.';
        if (assignees.length === 0) found.assignees = 'Assign it to at least one person.';
        if (day === undefined) found.due = 'Use a date like 2026-10-31.';
        if (reminder !== 'none' && !day) found.reminder = 'A reminder needs a due date.';
        if (Number.isNaN(minutes)) found.estimate = 'Use a time like 4h, 1h 30m or 90m.';
        setErrors(found);
        if (Object.keys(found).length) return;

        const body = {
            title: title.trim(), description, priority,
            assignedTo: manager ? assignees : [user._id],
            dueDate: day ? day.toISOString() : null,
            project: project || null,
            tags: tagsText.split(/[,\s]+/).filter(Boolean),
            reminder: { type: reminder },
            todoChecklist: checklist,
        };

        setSaving(true);
        setError('');
        try {
            if (id) {
                await api.put(API_PATHS.TASK(id), body);
                if (minutes !== null) await api.put(API_PATHS.TIME(id), { estimatedMinutes: minutes });
                navigation.goBack();
            } else {
                const { data } = await api.post(API_PATHS.TASKS, { ...body, status, estimatedMinutes: minutes });
                navigation.replace('TaskDetail', { id: data.task._id, title: data.task.title });
            }
        } catch (e) {
            const message = e.response?.data?.message || 'That did not save. Check your connection and try again.';
            setError(message);
            notify('Could not save the task', message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <Loading />;

    return (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
                <ErrorNote text={error} />

                <Field label="Task *" value={title} onChangeText={setTitle} placeholder="What needs to happen?" error={errors.title} accessibilityLabel="Task title" />

                <Text style={styles.label}>Assigned to *</Text>
                {manager ? (
                    <View style={styles.wrap}>
                        {[{ _id: user._id, name: 'Me' }, ...people.filter((p) => p._id !== user._id)].map((p) => (
                            <Chip key={p._id} label={p.name} active={assignees.includes(p._id)} onPress={() => toggleAssignee(p._id)} />
                        ))}
                    </View>
                ) : (
                    <Text style={styles.fixed}>Me (you can create tasks for yourself)</Text>
                )}
                {!!errors.assignees && <Text style={styles.error}>{errors.assignees}</Text>}

                <Text style={[styles.label, { marginTop: 14 }]}>Priority *</Text>
                <ChipRow options={PRIORITIES} value={priority} onChange={setPriority} />

                {!id && (
                    <>
                        <Text style={[styles.label, { marginTop: 14 }]}>Status *</Text>
                        <ChipRow options={['To Do', 'In Progress']} value={status} onChange={setStatus} />
                    </>
                )}

                <View style={{ marginTop: 14 }}>
                    <DateField label="Due date" value={due} onChange={setDue} error={errors.due} />
                </View>

                {projects.length > 0 && (
                    <>
                        <Text style={styles.label}>Project</Text>
                        <ChipRow options={[{ label: 'None', value: '' }, ...projects.map((p) => ({ label: p.name, value: p._id }))]} value={project} onChange={setProject} />
                    </>
                )}

                <Field style={{ marginTop: 14 }} label="Description" value={description} onChangeText={setDescription} multiline placeholder="Add the context whoever picks this up will need." />
                <Field label="Tags" value={tagsText} onChangeText={setTagsText} autoCapitalize="none" placeholder="#customer #billing" />

                <Text style={styles.label}>Reminder</Text>
                <ChipRow options={REMINDERS} value={reminder} onChange={setReminder} />
                {!!errors.reminder && <Text style={styles.error}>{errors.reminder}</Text>}

                <Field style={{ marginTop: 14 }} label="Estimated time" value={estimate} onChangeText={setEstimate} placeholder="optional, e.g. 4h" error={errors.estimate} autoCapitalize="none" />

                <Text style={styles.label}>Checklist</Text>
                {checklist.map((item, i) => (
                    <View key={`${item.text}${i}`} style={styles.itemRow}>
                        <Text style={styles.itemText}>{item.completed ? '☑' : '☐'}  {item.text}</Text>
                        <TouchableOpacity onPress={() => setChecklist((c) => c.filter((_, j) => j !== i))} accessibilityLabel={`Remove ${item.text}`}><Text style={styles.remove}>✕</Text></TouchableOpacity>
                    </View>
                ))}
                <View style={styles.addItem}>
                    <Field style={{ flex: 1, marginBottom: 0 }} value={newItem} onChangeText={setNewItem} placeholder="Add a step" onSubmitEditing={() => { if (newItem.trim()) { setChecklist((c) => [...c, { text: newItem.trim(), completed: false }]); setNewItem(''); } }} />
                    <Button title="Add" kind="secondary" disabled={!newItem.trim()} onPress={() => { setChecklist((c) => [...c, { text: newItem.trim(), completed: false }]); setNewItem(''); }} />
                </View>

                <Button title={id ? 'Save changes' : 'Create task'} onPress={submit} busy={saving} style={{ marginTop: 24 }} />
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    label: { fontSize: 12, fontWeight: '600', color: colors.muted, marginBottom: 6 },
    wrap: { flexDirection: 'row', flexWrap: 'wrap' },
    fixed: { fontSize: 14, color: colors.text, marginBottom: 4 },
    error: { color: colors.danger, fontSize: 12, marginTop: 4 },
    itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
    itemText: { flex: 1, fontSize: 14, color: colors.text },
    remove: { color: colors.muted, fontSize: 16, paddingHorizontal: 8 },
    addItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
});

export default TaskFormScreen;
