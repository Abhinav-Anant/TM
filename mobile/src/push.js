import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { API_PATHS } from './api';

const PUSH_KEY = 'pushToken';

// expo-notifications is loaded lazily, and never on web: the module is native-only, and a failure to
// load it must never stop the app starting.
const native = () => (Platform.OS === 'web' ? null : {
    Notifications: require('expo-notifications'),
    Device: require('expo-device'),
});

/** Shows alerts that arrive while the app is open, instead of swallowing them. */
export const setupNotificationHandler = () => {
    const n = native();
    if (!n) return;
    n.Notifications.setNotificationHandler({
        handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
};

/**
 * Asks permission, gets this phone's Expo push token and gives it to the server. Quietly does nothing on
 * web, on an emulator, when permission is refused, or when the app has no EAS project id yet - push is a
 * nicety on top of the in-app alerts, never a reason to fail sign-in.
 * Returns the token, or null.
 */
export const registerForPush = async () => {
    try {
        const n = native();
        if (!n || !n.Device.isDevice) return null;
        const { Notifications } = n;

        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('default', { name: 'Task alerts', importance: Notifications.AndroidImportance.DEFAULT });
        }
        let { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
        if (status !== 'granted') return null;

        const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
        if (!projectId) {
            console.warn('Push needs expo.extra.eas.projectId in app.json (run `eas init`).');
            return null;
        }
        const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
        await api.post(API_PATHS.PUSH_TOKEN, { token });
        await AsyncStorage.setItem(PUSH_KEY, token);
        return token;
    } catch (error) {
        console.warn('Push registration failed:', error.message);
        return null;
    }
};

/** On sign-out: tell the server this phone should stop buzzing for this account. */
export const unregisterPush = async () => {
    try {
        const token = await AsyncStorage.getItem(PUSH_KEY);
        if (!token) return;
        await api.delete(API_PATHS.PUSH_TOKEN, { data: { token } });
        await AsyncStorage.removeItem(PUSH_KEY);
    } catch {
        /* the server prunes dead tokens itself */
    }
};

/** Calls handler({ taskId }) when the user taps a push. Returns an unsubscribe function. */
export const onNotificationTap = (handler) => {
    const n = native();
    if (!n) return () => {};
    const sub = n.Notifications.addNotificationResponseReceivedListener((r) => handler(r.notification.request.content.data || {}));
    return () => sub.remove();
};
