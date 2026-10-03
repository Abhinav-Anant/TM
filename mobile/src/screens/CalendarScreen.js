import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import api, { API_PATHS } from '../api';
import { Card, Empty, ErrorNote } from '../ui';
import { monthGrid, itemsByDay, toDayText } from '../lib/logic';
import { colors, PRIORITY_COLOR } from '../theme';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** A month grid with a dot on every day something is due; tap a day to see what. */
const CalendarScreen = ({ navigation }) => {
    const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const [data, setData] = useState({ tasks: [], projects: [], recurring: [] });
    const [selected, setSelected] = useState(() => toDayText(new Date()));
    const [error, setError] = useState('');

    const days = useMemo(() => monthGrid(month), [month]);

    useEffect(() => {
        let cancelled = false;
        const start = days[0];
        const end = new Date(days[41].getFullYear(), days[41].getMonth(), days[41].getDate(), 23, 59, 59, 999);
        api.get(API_PATHS.CALENDAR, { params: { start: start.toISOString(), end: end.toISOString() } })
            .then(({ data: feed }) => { if (!cancelled) { setData(feed); setError(''); } })
            .catch((e) => { if (!cancelled) setError(e.response?.data?.message || 'Could not load the calendar.'); });
        return () => { cancelled = true; };
    }, [days]);

    const byDay = useMemo(() => itemsByDay(data), [data]);
    const today = toDayText(new Date());
    const items = byDay[selected] || [];

    const open = (item) => {
        if (item.kind === 'project') navigation.navigate('ProjectDetail', { id: item.projectId, title: item.title });
        else navigation.navigate('TaskDetail', { id: item.taskId, title: item.title });
    };
    const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

    return (
        <ScrollView style={styles.container} contentContainerStyle={{ padding: 12, paddingBottom: 32 }}>
            <View style={styles.nav}>
                <TouchableOpacity onPress={() => shift(-1)} accessibilityLabel="Previous month" style={styles.navBtn}><Text style={styles.navText}>‹</Text></TouchableOpacity>
                <Text style={styles.monthTitle} accessibilityRole="header">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
                <TouchableOpacity onPress={() => shift(1)} accessibilityLabel="Next month" style={styles.navBtn}><Text style={styles.navText}>›</Text></TouchableOpacity>
            </View>
            <ErrorNote text={error} />

            <View style={styles.week}>{WEEKDAYS.map((d, i) => <Text key={i} style={styles.weekday}>{d}</Text>)}</View>
            <View style={styles.grid}>
                {days.map((day) => {
                    const key = toDayText(day);
                    const list = byDay[key] || [];
                    const inMonth = day.getMonth() === month.getMonth();
                    return (
                        <TouchableOpacity
                            key={key} style={[styles.cell, key === selected && styles.cellSelected, !inMonth && { opacity: 0.35 }]}
                            onPress={() => setSelected(key)} accessibilityLabel={`${day.toDateString()}, ${list.length} items`}
                        >
                            <Text style={[styles.dayNum, key === today && styles.todayNum]}>{day.getDate()}</Text>
                            <View style={styles.dots}>
                                {list.slice(0, 3).map((item) => (
                                    <View key={item.key} style={[styles.dot, { backgroundColor: item.kind === 'project' ? colors.primary : (PRIORITY_COLOR[item.priority] || colors.muted) }, item.kind === 'repeat' && { opacity: 0.4 }]} />
                                ))}
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </View>

            <Text style={styles.selectedTitle}>{new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
            {items.length === 0 && <Empty text="Nothing on this day." />}
            {items.map((item) => (
                <Card key={item.key} onPress={() => open(item)}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    <Text style={styles.itemMeta}>{item.kind === 'project' ? 'Project deadline' : item.kind === 'repeat' ? 'Repeats (upcoming)' : item.status}</Text>
                </Card>
            ))}
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    navBtn: { paddingHorizontal: 16, paddingVertical: 6 },
    navText: { fontSize: 26, color: colors.primary },
    monthTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    week: { flexDirection: 'row' },
    weekday: { flex: 1, textAlign: 'center', fontSize: 11, color: colors.muted, paddingVertical: 4 },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: 'transparent' },
    cellSelected: { borderColor: colors.primary, backgroundColor: '#EFF6FF' },
    dayNum: { fontSize: 13, color: colors.text },
    todayNum: { color: colors.primary, fontWeight: '800' },
    dots: { flexDirection: 'row', gap: 2, height: 6, marginTop: 3 },
    dot: { width: 5, height: 5, borderRadius: 3 },
    selectedTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 18, marginBottom: 8 },
    itemTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
    itemMeta: { fontSize: 12, color: colors.muted, marginTop: 3 },
});

export default CalendarScreen;
