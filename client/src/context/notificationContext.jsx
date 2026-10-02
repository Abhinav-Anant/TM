import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS, BASE_URL } from '../utils/apiPaths';
import { UserContext } from './userContext';

export const NotificationContext = createContext();

const MAX_BACKOFF_MS = 30000;

/**
 * Reads the SSE stream with fetch() rather than EventSource so the JWT travels
 * in the Authorization header instead of the query string.
 */
const readStream = async (response, onEvent) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
        const { value, done } = await reader.read();
        if (done) return;

        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);

            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (line) {
                try {
                    onEvent(JSON.parse(line.slice(5).trim()));
                } catch {
                    // Ignore malformed frames rather than killing the stream.
                }
            }
            boundary = buffer.indexOf("\n\n");
        }
    }
};

const NotificationProvider = ({ children }) => {
    const { user } = useContext(UserContext);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [connected, setConnected] = useState(false);
    const abortRef = useRef(null);

    const fetchNotifications = useCallback(async () => {
        try {
            const { data } = await axiosInstance.get(API_PATHS.NOTIFICATIONS.GET_ALL);
            setNotifications(data?.notifications || []);
            setUnreadCount(data?.unreadCount || 0);
        } catch (error) {
            console.error("Failed to load notifications", error);
        }
    }, []);

    const markAsRead = useCallback(async (id) => {
        setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, read: true } : n)));
        setUnreadCount((count) => Math.max(0, count - 1));
        try {
            const { data } = await axiosInstance.put(API_PATHS.NOTIFICATIONS.MARK_READ(id));
            setUnreadCount(data?.unreadCount ?? 0);
        } catch {
            fetchNotifications(); // resync if the optimistic update was wrong
        }
    }, [fetchNotifications]);

    const markAllAsRead = useCallback(async () => {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
        try {
            await axiosInstance.put(API_PATHS.NOTIFICATIONS.MARK_ALL_READ);
        } catch {
            fetchNotifications();
        }
    }, [fetchNotifications]);

    const removeNotification = useCallback(async (id) => {
        setNotifications((prev) => prev.filter((n) => n._id !== id));
        try {
            const { data } = await axiosInstance.delete(API_PATHS.NOTIFICATIONS.DELETE(id));
            setUnreadCount(data?.unreadCount ?? 0);
        } catch {
            fetchNotifications();
        }
    }, [fetchNotifications]);

    useEffect(() => {
        if (!user) {
            setNotifications([]);
            setUnreadCount(0);
            return undefined;
        }

        fetchNotifications();

        let cancelled = false;
        let retries = 0;
        let retryTimer = null;

        const connect = async () => {
            const controller = new AbortController();
            abortRef.current = controller;

            try {
                const response = await fetch(`${BASE_URL}${API_PATHS.NOTIFICATIONS.STREAM}`, {
                    credentials: "same-origin", // session cookie
                    signal: controller.signal,
                });

                if (!response.ok || !response.body) throw new Error(`Stream failed: ${response.status}`);

                retries = 0;
                setConnected(true);

                await readStream(response, (event) => {
                    if (event.type === "ping" || event.type === "connected") return;

                    setNotifications((prev) => [event, ...prev].slice(0, 30));
                    // Server-supplied count, not a local increment - the list is capped
                    // at 30 so it cannot be derived, and incrementing drifts on replay.
                    setUnreadCount((count) => event.unreadCount ?? count + 1);
                    toast(event.title, { icon: "🔔" });
                });
            } catch {
                if (controller.signal.aborted) return;
            }

            setConnected(false);
            if (cancelled) return;

            // Exponential backoff, capped - a dropped stream should not hammer the server.
            retries += 1;
            retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retries, MAX_BACKOFF_MS));
        };

        connect();

        return () => {
            cancelled = true;
            clearTimeout(retryTimer);
            abortRef.current?.abort();
        };
    }, [user, fetchNotifications]);

    return (
        <NotificationContext.Provider
            value={{
                notifications,
                unreadCount,
                connected,
                fetchNotifications,
                markAsRead,
                markAllAsRead,
                removeNotification,
            }}
        >
            {children}
        </NotificationContext.Provider>
    );
};

export default NotificationProvider;
