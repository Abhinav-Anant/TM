import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { API_PATHS, TOKEN_KEY, setSessionExpiredHandler } from './api';
import { registerForPush, unregisterPush } from './push';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const clear = useCallback(async () => {
        await AsyncStorage.removeItem(TOKEN_KEY);
        setUser(null);
    }, []);

    // A 401 from any request ends the session (expired or revoked token).
    useEffect(() => { setSessionExpiredHandler(clear); }, [clear]);

    useEffect(() => {
        (async () => {
            const token = await AsyncStorage.getItem(TOKEN_KEY);
            if (!token) return setLoading(false);

            try {
                const { data } = await api.get(API_PATHS.PROFILE);
                setUser(data);
                registerForPush();
            } catch {
                await AsyncStorage.removeItem(TOKEN_KEY);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const login = useCallback(async (email, password) => {
        const { data } = await api.post(API_PATHS.LOGIN, { email, password });
        if (!data?.token) throw new Error('No token returned');
        await AsyncStorage.setItem(TOKEN_KEY, data.token);
        setUser(data);
        registerForPush();
        return data;
    }, []);

    const logout = useCallback(async () => {
        await unregisterPush(); // while the token still works
        await clear();
    }, [clear]);

    // After the profile is edited: keep what we show in step with what the server stored.
    const updateUser = useCallback((patch) => setUser((prev) => ({ ...prev, ...patch })), []);

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
            {children}
        </AuthContext.Provider>
    );
};

export const canManage = (user) => user?.role === 'admin' || user?.role === 'head';
