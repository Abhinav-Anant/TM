import axios from 'axios';
import { Platform } from 'react-native';
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

// A 401 anywhere (other than the sign-in call itself) means the session is gone: the auth layer listens.
let onSessionExpired = () => {};
export const setSessionExpiredHandler = (fn) => { onSessionExpired = fn; };
api.interceptors.response.use((r) => r, (error) => {
    if (error.response?.status === 401 && error.config?.url !== API_PATHS.LOGIN) onSessionExpired();
    return Promise.reject(error);
});

export const API_PATHS = {
    LOGIN: '/api/auth/login',
    PROFILE: '/api/auth/profile',
    TASKS: '/api/tasks',
    TASK: (id) => `/api/tasks/${id}`,
    TODO: (id) => `/api/tasks/${id}/todo`,
    STATUS: (id) => `/api/tasks/${id}/status`,
    REVIEW: (id) => `/api/tasks/${id}/review`,
    COMMENTS: (id) => `/api/tasks/${id}/comments`,
    WATCH: (id) => `/api/tasks/${id}/watch`,
    SUBTASKS: (id) => `/api/tasks/${id}/subtasks`,
    SUBTASK: (id, sub) => `/api/tasks/${id}/subtasks/${sub}`,
    TIME: (id) => `/api/tasks/${id}/time`,
    TIMER_START: (id) => `/api/tasks/${id}/timer/start`,
    TIMER_STOP: (id) => `/api/tasks/${id}/timer/stop`,
    UPLOAD: '/api/tasks/upload',
    ATTACH: (id) => `/api/tasks/${id}/attachments`,
    FILE_LINK: (fileId) => `/api/files/${fileId}/link`,
    CATEGORIES: '/api/tasks/categories',
    TAGS: '/api/tasks/tags',
    ANALYTICS: '/api/tasks/analytics',
    MY_DASHBOARD: '/api/tasks/my-dashboard',
    MANAGER_DASHBOARD: '/api/tasks/manager-dashboard',
    COMPANY_DASHBOARD: '/api/tasks/company-dashboard',
    PROJECTS: '/api/projects',
    PROJECT: (id) => `/api/projects/${id}`,
    CALENDAR: '/api/calendar',
    USERS: '/api/users',
    NOTIFICATIONS: '/api/notifications',
    MARK_READ: (id) => `/api/notifications/${id}/read`,
    MARK_ALL_READ: '/api/notifications/read-all',
    PREFERENCES: '/api/notifications/preferences',
    PUSH_TOKEN: '/api/notifications/push-token',
};

/**
 * Uploads one picked file (camera shot, gallery photo or document) and attaches it to a task.
 * `asset` is { uri, name, mimeType } from expo-image-picker / expo-document-picker.
 */
export const uploadAndAttach = async (taskId, asset) => {
    const name = asset.name || asset.fileName || `photo-${Date.now()}.jpg`;
    const type = asset.mimeType || asset.type || 'image/jpeg';
    const form = new FormData();
    if (Platform.OS === 'web') {
        // The browser needs a real Blob; React Native takes the { uri, name, type } shape.
        form.append('files', await (await fetch(asset.uri)).blob(), name);
    } else {
        form.append('files', { uri: asset.uri, name, type });
    }
    const { data } = await api.post(API_PATHS.UPLOAD, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
        transformRequest: (body) => body, // keep RN's FormData intact
    });
    const attached = await api.post(API_PATHS.ATTACH(taskId), { urls: data.urls });
    return attached.data.attachments;
};

export default api;
