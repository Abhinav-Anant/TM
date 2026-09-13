import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { API_PATHS, TOKEN_KEY } from './api';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const token = await AsyncStorage.getItem(TOKEN_KEY);
            if (!token) return setLoading(false);

            try {
                const { data } = await api.get(API_PATHS.PROFILE);
                setUser(data);
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
        return data;
    }, []);

    const logout = useCallback(async () => {
        await AsyncStorage.removeItem(TOKEN_KEY);
        setUser(null);
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};
