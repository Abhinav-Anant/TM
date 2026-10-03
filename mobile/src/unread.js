import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api, { API_PATHS } from './api';
import { useAuth } from './auth';

const UnreadContext = createContext({ unread: 0, refreshUnread: () => {} });
export const useUnread = () => useContext(UnreadContext);

const POLL_MS = 30000;

/**
 * Unread count for the Alerts tab badge. React Native's fetch cannot stream, so the web app's live channel
 * does not apply here: poll lightly (one row) instead. Push covers the "app is closed" case.
 */
export const UnreadProvider = ({ children }) => {
    const { user } = useAuth();
    const [unread, setUnread] = useState(0);

    const refreshUnread = useCallback(async () => {
        try {
            const { data } = await api.get(API_PATHS.NOTIFICATIONS, { params: { limit: 1 } });
            setUnread(data.unreadCount || 0);
        } catch { /* keep the last number */ }
    }, []);

    useEffect(() => {
        if (!user) { setUnread(0); return undefined; }
        refreshUnread();
        const timer = setInterval(refreshUnread, POLL_MS);
        return () => clearInterval(timer);
    }, [user, refreshUnread]);

    return <UnreadContext.Provider value={{ unread, refreshUnread, setUnread }}>{children}</UnreadContext.Provider>;
};
