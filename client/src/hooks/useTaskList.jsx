import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import { EMPTY_FILTERS, toQueryParams } from '../components/TaskFilters';

/** Shared task-list state (status tab + search/filter/sort) for the admin and member views. */
const useTaskList = () => {
    const [tasks, setTasks] = useState([]);
    const [tabs, setTabs] = useState([]);
    const [categories, setCategories] = useState([]);
    const [tags, setTags] = useState([]);
    const [status, setStatus] = useState("All");
    const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await axiosInstance.get(API_PATHS.TASKS.GET_ALL_TASKS, {
                params: toQueryParams(filters, status),
            });

            setTasks(data?.tasks || []);

            const summary = data?.statusSummary || {};
            setTabs([
                { label: "All", count: summary.all || 0 },
                { label: "To Do", count: summary.pendingTasks || 0 },
                { label: "In Progress", count: summary.inProgressTasks || 0 },
                { label: "Blocked", count: summary.blockedTasks || 0 },
                { label: "In Review", count: summary.inReviewTasks || 0 },
                { label: "Completed", count: summary.completedTasks || 0 },
                { label: "Cancelled", count: summary.cancelledTasks || 0 },
            ]);
        } catch (error) {
            console.error("Error fetching tasks:", error);
            toast.error("Failed to fetch tasks.");
        } finally {
            setLoading(false);
        }
    }, [filters, status]);

    useEffect(() => { refresh(); }, [refresh]);

    useEffect(() => {
        axiosInstance
            .get(API_PATHS.TASKS.GET_CATEGORIES)
            .then(({ data }) => setCategories(data?.categories || []))
            .catch(() => setCategories([]));
        axiosInstance
            .get(API_PATHS.TASKS.GET_TAGS)
            .then(({ data }) => setTags(data?.tags || []))
            .catch(() => setTags([]));
    }, []);

    return { tasks, tabs, categories, tags, status, setStatus, filters, setFilters, loading, refresh };
};

export default useTaskList;
