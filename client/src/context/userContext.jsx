import React, { createContext, useEffect, useState } from 'react';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from "../utils/apiPaths";


export const UserContext = createContext();


const UserProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true)


    const fetchUser = async () => {
        try {
            const response = await axiosInstance.get(API_PATHS.AUTH.GET_PROFILE);
            setUser(response.data)
        } catch (error) {
            console.error("User is not auathenticated", error)
            clearUser();
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (user) return;

        // The session lives in an HttpOnly cookie we cannot read: ask the server.
        fetchUser();

    }, [])


    const updatedUser = (userData) => {
        setUser(userData)
        setLoading(false)
    }

    const clearUser = () => {
        setUser(null)
    }

    return (
        <UserContext.Provider value={{ user, loading, updatedUser, clearUser }}>
            {children}
        </UserContext.Provider>
    )
}

export default UserProvider;