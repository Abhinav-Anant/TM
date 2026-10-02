import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import { useSearchParams } from 'react-router-dom';
import { EMPTY_FILTERS, toQueryParams } from '../components/TaskFilters';

/** Shared task-list state (status tab + search/filter/sort) for the admin and member views. */
const PAGE_SIZE = 24; // divisible by the 1/2/3-column card grids

const useTaskList = () => {
    const [tasks, setTasks] = useState([]);
    const [tabs, setTabs] = useState([]);
    const [categories, setCategories] = useState([]);
    const [tags, setTags] = useState([]);
    const [projects, setProjects] = useState([]);
    const [status, setStatus] = useState("All");
    // The manager dashboard links here with ?assignee=<id> to show one employee's tasks.
    const [searchParams] = useSearchParams();
    const [filters, setFilters] = useState({ ...EMPTY_FILTERS, assignee: searchParams.get("assignee") || "" });
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await axiosInstance.get(API_PATHS.TASKS.GET_ALL_TASKS, {
                params: { ...toQueryParams(filters, status), page, limit: PAGE_SIZE },
            });

            setTasks(data?.tasks || []);
            setPagination(data?.pagination || { page: 1, pages: 1, total: 0 });

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
    }, [filters, status, page]);

    useEffect(() => { refresh(); }, [refresh]);

    // A new tab or filter is a new result set: start from its first page.
    useEffect(() => { setPage(1); }, [filters, status]);

    useEffect(() => {
        axiosInstance
            .get(API_PATHS.TASKS.GET_CATEGORIES)
            .then(({ data }) => setCategories(data?.categories || []))
            .catch(() => setCategories([]));
        axiosInstance
            .get(API_PATHS.TASKS.GET_TAGS)
            .then(({ data }) => setTags(data?.tags || []))
            .catch(() => setTags([]));
        axiosInstance
            .get(API_PATHS.PROJECTS.GET_ALL, { params: { limit: 100 } })
            .then(({ data }) => setProjects((data?.projects || []).map((p) => ({ _id: p._id, name: p.name }))))
            .catch(() => setProjects([]));
    }, []);

    return { tasks, tabs, categories, tags, projects, status, setStatus, filters, setFilters, loading, refresh, page, setPage, pagination };
};

export default useTaskList;
