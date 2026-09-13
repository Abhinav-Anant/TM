import React from 'react';
import { ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './src/auth';
import LoginScreen from './src/screens/LoginScreen';
import TasksScreen from './src/screens/TasksScreen';
import TaskDetailScreen from './src/screens/TaskDetailScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import AnalyticsScreen from './src/screens/AnalyticsScreen';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TasksStack = () => (
    <Stack.Navigator>
        <Stack.Screen name="TaskList" component={TasksScreen} options={{ title: 'My Tasks' }} />
        <Stack.Screen
            name="TaskDetail"
            component={TaskDetailScreen}
            options={({ route }) => ({ title: route.params?.title || 'Task' })}
        />
    </Stack.Navigator>
);

// Emoji icons keep the dependency list short - swap for @expo/vector-icons if you want real glyphs.
const tabIcon = (glyph) => ({ color }) => <Text style={{ fontSize: 18, color }}>{glyph}</Text>;

const AppTabs = () => (
    <Tab.Navigator
        screenOptions={{
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.muted,
        }}
    >
        <Tab.Screen
            name="Tasks"
            component={TasksStack}
            options={{ headerShown: false, tabBarIcon: tabIcon('📋') }}
        />
        <Tab.Screen
            name="Alerts"
            component={NotificationsScreen}
            options={{ title: 'Notifications', tabBarIcon: tabIcon('🔔') }}
        />
        <Tab.Screen
            name="Me"
            component={AnalyticsScreen}
            options={{ title: 'Progress', tabBarIcon: tabIcon('📊') }}
        />
    </Tab.Navigator>
);

const Root = () => {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator color={colors.primary} size="large" />
            </View>
        );
    }

    return (
        <NavigationContainer>
            {user ? <AppTabs /> : <LoginScreen />}
        </NavigationContainer>
    );
};

export default function App() {
    return (
        <SafeAreaProvider>
            <AuthProvider>
                <StatusBar style="dark" />
                <Root />
            </AuthProvider>
        </SafeAreaProvider>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
