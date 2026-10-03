import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import api, { API_PATHS } from '../api';
import { useAuth, canManage } from '../auth';
import { Button, Tile, Section, ErrorNote } from '../ui';
import { colors } from '../theme';

const greeting = () => {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
};

const HomeScreen = ({ navigation }) => {
    const { user } = useAuth();
    const [mine, setMine] = useState(null);
    const [team, setTeam] = useState(null);
    const [company, setCompany] = useState(null);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        const params = { tzOffset: new Date().getTimezoneOffset() };
        try {
            setError('');
            const [m, t, c] = await Promise.all([
                api.get(API_PATHS.MY_DASHBOARD, { params }),
                canManage(user) ? api.get(API_PATHS.MANAGER_DASHBOARD, { params }) : null,
                user?.role === 'admin' ? api.get(API_PATHS.COMPANY_DASHBOARD, { params }) : null,
            ]);
            setMine(m.data);
            setTeam(t?.data.totals || null);
            setCompany(c?.data || null);
        } catch (e) {
            setError(e.response?.data?.message || 'Could not load your numbers. Pull down to try again.');
        } finally {
            setRefreshing(false);
        }
    }, [user]);

    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => { load(); }, [load]);

    const openWork = (tab) => navigation.navigate('MyWork', { tab });

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
            <Text style={styles.hello}>{greeting()}, {user?.name?.split(' ')[0] || 'there'}</Text>
            <Text style={styles.sub}>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>

            <ErrorNote text={error} />

            <Section title="Your work">
                <View style={styles.grid}>
                    <Tile label="Overdue" value={mine?.overdue} tone={mine?.overdue ? colors.danger : undefined} onPress={() => openWork('Overdue')} />
                    <Tile label="Due today" value={mine?.dueToday} tone={mine?.dueToday ? '#D97706' : undefined} onPress={() => openWork('Today')} />
                    <Tile label="In progress" value={mine?.inProgress} onPress={() => openWork('All')} />
                    <Tile label="Upcoming" value={mine?.upcoming} onPress={() => openWork('Upcoming')} />
                    <Tile label="Done this week" value={mine?.completedThisWeek} tone="#65A30D" onPress={() => openWork('Completed')} />
                </View>
            </Section>

            {team && (
                <Section title={user?.role === 'admin' ? 'The whole team' : 'Your department'}>
                    <View style={styles.grid}>
                        <Tile label="Open tasks" value={team.open} />
                        <Tile label="Overdue" value={team.overdue} tone={team.overdue ? colors.danger : undefined} />
                        <Tile label="Due today" value={team.dueToday} />
                        <Tile label="Blocked" value={team.blocked} tone={team.blocked ? colors.danger : undefined} />
                        <Tile label="In review" value={team.inReview} />
                        <Tile label="Done this week" value={team.completedThisWeek} tone="#65A30D" />
                    </View>
                </Section>
            )}

            {company && (
                <Section title="Company">
                    <View style={styles.grid}>
                        <Tile label="Employees" value={company.employees} />
                        <Tile label="Departments" value={company.departments} />
                        <Tile label="Projects" value={company.projects} />
                        <Tile label="Active projects" value={company.activeProjects} />
                    </View>
                </Section>
            )}

            <View style={styles.actions}>
                <Button title="New task" onPress={() => navigation.navigate('TaskForm')} />
                <Button title="Calendar" kind="secondary" onPress={() => navigation.navigate('Calendar')} />
                <Button title="Progress" kind="secondary" onPress={() => navigation.navigate('Progress')} />
            </View>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    hello: { fontSize: 24, fontWeight: '700', color: colors.text },
    sub: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: 4 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    actions: { marginTop: 24, gap: 10 },
});

export default HomeScreen;
