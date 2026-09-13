import axios from 'axios';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Point this at your server: EXPO_PUBLIC_API_URL in .env, or `extra.apiUrl` in app.json.
// A physical device cannot reach "localhost" - use your machine's LAN IP.
export const BASE_URL =
    process.env.EXPO_PUBLIC_API_URL ||
    Constants.expoConfig?.extra?.apiUrl ||
    'http://localhost:8000';

export const TOKEN_KEY = 'token';

const api = axios.create({
    baseURL: BASE_URL,
    timeout: 15000,
    headers: { Accept: 'application/json' },
});

api.interceptors.request.use(async (config) => {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

export const API_PATHS = {
    LOGIN: '/api/auth/login',
    PROFILE: '/api/auth/profile',
    TASKS: '/api/tasks',
    TASK: (id) => `/api/tasks/${id}`,
    TODO: (id) => `/api/tasks/${id}/todo`,
    STATUS: (id) => `/api/tasks/${id}/status`,
    COMMENTS: (id) => `/api/tasks/${id}/comments`,
    CATEGORIES: '/api/tasks/categories',
    ANALYTICS: '/api/tasks/analytics',
    NOTIFICATIONS: '/api/notifications',
    MARK_READ: (id) => `/api/notifications/${id}/read`,
    MARK_ALL_READ: '/api/notifications/read-all',
};

export default api;
