import React, { useEffect } from 'react';
import { ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './src/auth';
import { UnreadProvider, useUnread } from './src/unread';
import { setupNotificationHandler, onNotificationTap } from './src/push';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import MyWorkScreen from './src/screens/MyWorkScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import ProjectDetailScreen from './src/screens/ProjectDetailScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import NotificationSettingsScreen from './src/screens/NotificationSettingsScreen';
import TaskDetailScreen from './src/screens/TaskDetailScreen';
import TaskFormScreen from './src/screens/TaskFormScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import AnalyticsScreen from './src/screens/AnalyticsScreen';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

setupNotificationHandler();

// Emoji icons keep the dependency list short - swap for @expo/vector-icons if you want real glyphs.
const tabIcon = (glyph) => ({ color }) => <Text style={{ fontSize: 18, color }}>{glyph}</Text>;

// Primary navigation, as specified: Home, My Work, Projects, Notifications, Profile.
const AppTabs = () => {
    const { unread } = useUnread();
    return (
        <Tab.Navigator screenOptions={{ tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.muted }}>
            <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarIcon: tabIcon('🏠') }} />
            <Tab.Screen name="MyWork" component={MyWorkScreen} options={{ title: 'My Work', tabBarIcon: tabIcon('✅') }} />
            <Tab.Screen name="Projects" component={ProjectsScreen} options={{ tabBarIcon: tabIcon('📁') }} />
            <Tab.Screen
                name="Alerts" component={NotificationsScreen}
                options={{ title: 'Notifications', tabBarLabel: 'Alerts', tabBarIcon: tabIcon('🔔'), tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined }}
            />
            <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarIcon: tabIcon('👤') }} />
        </Tab.Navigator>
    );
};

const AppStack = () => (
    <Stack.Navigator>
        <Stack.Screen name="Tabs" component={AppTabs} options={{ headerShown: false }} />
        <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: 'Task' }} />
        <Stack.Screen name="TaskForm" component={TaskFormScreen} options={{ title: 'New task' }} />
        <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} options={{ title: 'Project' }} />
        <Stack.Screen name="Calendar" component={CalendarScreen} />
        <Stack.Screen name="Progress" component={AnalyticsScreen} />
        <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ title: 'Notification settings' }} />
    </Stack.Navigator>
);

const Root = () => {
    const { user, loading } = useAuth();

    // Tapping a push opens the task it is about.
    useEffect(() => {
        if (!user) return undefined;
        return onNotificationTap(({ taskId }) => {
            if (taskId && navigationRef.isReady()) navigationRef.navigate('TaskDetail', { id: taskId });
        });
    }, [user]);

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator color={colors.primary} size="large" />
            </View>
        );
    }

    return (
        <NavigationContainer ref={navigationRef}>
            {user ? <AppStack /> : <LoginScreen />}
        </NavigationContainer>
    );
};

export default function App() {
    return (
        <SafeAreaProvider>
            <AuthProvider>
                <UnreadProvider>
                    <StatusBar style="dark" />
                    <Root />
                </UnreadProvider>
            </AuthProvider>
        </SafeAreaProvider>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
