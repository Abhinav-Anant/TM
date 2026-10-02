import React, { useContext, useEffect, useState } from 'react';
import moment from 'moment';
import toast from 'react-hot-toast';
import { LuSearch, LuX, LuFilter, LuBookmark } from 'react-icons/lu';
import { PRIORITY_DATA, SORT_OPTIONS } from '../utils/data';
import { UserContext } from '../context/userContext';
import { canAssignTasks } from '../utils/roles';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';

export const EMPTY_FILTERS = {
    search: "",
    priority: "",
    category: "",
    tag: "",
    project: "",
    assignee: "",
    department: "",
    duePreset: "",
    mine: false,
    dueAfter: "",
    dueBefore: "",
    overdue: false,
    sort: "createdAt:desc",
};

const SEARCH_DEBOUNCE_MS = 350;

const DUE_PRESETS = [
    { value: "", label: "Any due date" },
    { value: "overdue", label: "Overdue" },
    { value: "today", label: "Due today" },
    { value: "week", label: "Due this week" },
    { value: "next7", label: "Next 7 days" },
];

const selectClass =
    "field py-2 cursor-pointer";

/**
 * Search + advanced filter bar. Native <select> and <input type="date"> instead of
 * custom widgets - they are keyboard and screen-reader correct for free.
 */
const TaskFilters = ({ filters, setFilters, categories = [], tags = [], projects = [] }) => {
    const [searchText, setSearchText] = useState(filters.search);
    const [expanded, setExpanded] = useState(false);
    const { user } = useContext(UserContext);
    const [people, setPeople] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [saved, setSaved] = useState([]);
    const [naming, setNaming] = useState(false);
    const [saveName, setSaveName] = useState("");
    const manager = canAssignTasks(user);

    useEffect(() => {
        axiosInstance.get(API_PATHS.SAVED_FILTERS.GET_ALL).then(({ data }) => setSaved(data.filters || [])).catch(() => {});
        if (!manager) return;
        axiosInstance.get(API_PATHS.USERS.GET_ALL_USERS).then(({ data }) => setPeople(data || [])).catch(() => {});
        axiosInstance.get(API_PATHS.DEPARTMENTS.GET_ALL).then(({ data }) => setDepartments(data.departments || [])).catch(() => {});
    }, [manager]);

    // Debounce typing so each keystroke is not a request.
    useEffect(() => {
        if (searchText === filters.search) return undefined;
        const timer = setTimeout(
            () => setFilters((prev) => ({ ...prev, search: searchText })),
            SEARCH_DEBOUNCE_MS
        );
        return () => clearTimeout(timer);
    }, [searchText, filters.search, setFilters]);

    // Keep the input in sync when the parent resets filters.
    useEffect(() => {
        setSearchText(filters.search);
    }, [filters.search]);

    const update = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

    const activeCount = [
        filters.priority,
        filters.category,
        filters.tag,
        filters.project,
        filters.assignee,
        filters.department,
        filters.duePreset,
        filters.mine ? "y" : "",
        filters.dueAfter,
        filters.dueBefore,
        filters.overdue ? "y" : "",
    ].filter(Boolean).length;

    const reset = () => {
        setSearchText("");
        setFilters({ ...EMPTY_FILTERS });
    };

    const saveCurrent = async (e) => {
        e.preventDefault();
        if (!saveName.trim()) return;
        try {
            const { data } = await axiosInstance.post(API_PATHS.SAVED_FILTERS.CREATE, { name: saveName, filters });
            setSaved((prev) => [...prev, data.filter].sort((x, y) => x.name.localeCompare(y.name)));
            setSaveName("");
            setNaming(false);
            toast.success("Filter saved");
        } catch (error) {
            toast.error(error.response?.data?.message || "Could not save the filter.");
        }
    };

    const removeSaved = async (id) => {
        try {
            await axiosInstance.delete(API_PATHS.SAVED_FILTERS.DELETE(id));
            setSaved((prev) => prev.filter((f) => f._id !== id));
        } catch {
            toast.error("Could not delete the filter.");
        }
    };

    const categoryOptions = categories.length
        ? categories
        : [];

    return (
        <div className="panel p-3 mt-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="field flex-1 min-w-[200px] flex items-center gap-2 py-2">
                    <LuSearch className="text-dusk shrink-0" />
                    <input
                        type="search"
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder="Search tasks by title or description"
                        aria-label="Search tasks"
                        className="w-full text-sm text-beam placeholder:text-dusk outline-none bg-transparent"
                    />
                </div>

                <select
                    className={`${selectClass} w-auto`}
                    value={filters.sort}
                    aria-label="Sort tasks"
                    onChange={(e) => update("sort", e.target.value)}
                >
                    {SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>

                <button
                    type="button"
                    className={`flex items-center gap-2 text-sm px-3 py-2 rounded-md border cursor-pointer ${
                        activeCount ? "border-signal/40 bg-signal/10 text-signal" : "border-white/12 text-mist hover:text-beam"
                    }`}
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                >
                    <LuFilter />
                    Filters{activeCount ? ` (${activeCount})` : ""}
                </button>

                {(activeCount > 0 || filters.search) && (
                    <button
                        type="button"
                        className="flex items-center gap-1.5 text-sm text-dusk hover:text-alert px-2 py-2 cursor-pointer transition-colors"
                        onClick={reset}
                    >
                        <LuX /> Clear
                    </button>
                )}
            </div>

            {(saved.length > 0 || activeCount > 0 || filters.search) && (
                <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-white/8">
                    <LuBookmark className="text-dusk" aria-hidden="true" />
                    {saved.map((f) => (
                        <span key={f._id} className="chip chip-mist gap-1.5">
                            <button type="button" className="cursor-pointer hover:text-beam" onClick={() => { setSearchText(f.filters.search || ""); setFilters({ ...EMPTY_FILTERS, ...f.filters }); }}>
                                {f.name}
                            </button>
                            <button type="button" className="cursor-pointer text-dusk hover:text-alert" aria-label={`Delete saved filter ${f.name}`} onClick={() => removeSaved(f._id)}>
                                <LuX />
                            </button>
                        </span>
                    ))}
                    {naming ? (
                        <form onSubmit={saveCurrent} className="flex items-center gap-2">
                            <input
                                className="field py-1.5 w-44" placeholder="Name this filter" aria-label="Saved filter name"
                                value={saveName} onChange={(e) => setSaveName(e.target.value)} autoFocus maxLength={60}
                            />
                            <button type="submit" className="btn btn-sm btn-primary" disabled={!saveName.trim()}>Save</button>
                            <button type="button" className="btn btn-sm" onClick={() => setNaming(false)}>Cancel</button>
                        </form>
                    ) : (
                        (activeCount > 0 || filters.search) && (
                            <button type="button" className="text-xs text-signal hover:underline cursor-pointer" onClick={() => setNaming(true)}>
                                Save this filter
                            </button>
                        )
                    )}
                </div>
            )}

            {expanded && (
                <div className="enter-fade grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-3 pt-3 border-t border-white/8">
                    <label className="flex flex-col gap-1.5 text-xs font-medium text-mist">
                        Priority
                        <select
                            className={selectClass}
                            value={filters.priority}
                            onChange={(e) => update("priority", e.target.value)}
                        >
                            <option value="">Any priority</option>
                            {PRIORITY_DATA.map((p) => (
                                <option key={p.value} value={p.value}>{p.label}</option>
                            ))}
                        </select>
                    </label>

                    <label className="flex flex-col gap-1.5 text-xs font-medium text-mist">
                        Category
                        <select
                            className={selectClass}
                            value={filters.category}
                            onChange={(e) => update("category", e.target.value)}
                        >
                            <option value="">All categories</option>
                            {categoryOptions.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </label>

                    <label className="flex flex-col gap-1.5 text-xs font-medium text-mist">
                        Project
                        <select
                            className={selectClass}
                            value={filters.project}
                            onChange={(e) => update("project", e.target.value)}
                        >
                            <option value="">All projects</option>
                            {projects.map((p) => (
                                <option key={p._id} value={p._id}>{p.name}</option>
                            ))}
                        </select>
                    </label>

                    {manager && (
                        <label className="flex flex-col gap-1.5 text-xs font-medium text-mist">
                            Employee
                            <select className={selectClass} value={filters.assignee} onChange={(e) => update("assignee", e.target.value)}>
                                <option value="">Everyone</option>
                                {people.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                            </select>
                        </label>
                    )}

                    {manager && (
                        <label className="flex flex-col gap-1.5 text-xs font-medium text-mist">
                            Department
                            <select className={selectClass} value={filters.department} onChange={(e) => update("department", e.target.value)}>
                                <option value="">All departments</option>
                                {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
                            </select>
                        </label>
                    )}

                    <label className="flex flex-col gap-1.5 text-xs font-medium text-mist">
                        Due
                        <select className={selectClass} value={filters.duePreset} onChange={(e) => update("duePreset", e.target.value)}>
                            {DUE_PRESETS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                    </label>

                    <label className="flex flex-col gap-1.5 text-xs font-medium text-mist">
                        Tag
                        <select
                            className={selectClass}
                            value={filters.tag}
                            onChange={(e) => update("tag", e.target.value)}
                        >
                            <option value="">All tags</option>
                            {tags.map((t) => (
                                <option key={t} value={t}>#{t}</option>
                            ))}
                        </select>
                    </label>

                    <label className="flex flex-col gap-1.5 text-xs font-medium text-mist">
                        Due from
                        <input
                            type="date"
                            className={selectClass}
                            value={filters.dueAfter}
                            onChange={(e) => update("dueAfter", e.target.value)}
                        />
                    </label>

                    <label className="flex flex-col gap-1.5 text-xs font-medium text-mist">
                        Due until
                        <input
                            type="date"
                            className={selectClass}
                            value={filters.dueBefore}
                            onChange={(e) => update("dueBefore", e.target.value)}
                        />
                    </label>

                    <label className="flex items-end gap-2 text-sm text-mist pb-2.5 cursor-pointer">
                        <input
                            type="checkbox"
                            className="w-4 h-4 rounded"
                            checked={filters.mine}
                            onChange={(e) => update("mine", e.target.checked)}
                        />
                        Assigned to me
                    </label>

                    <label className="flex items-end gap-2 text-sm text-mist pb-2.5 cursor-pointer">
                        <input
                            type="checkbox"
                            className="w-4 h-4 rounded"
                            checked={filters.overdue}
                            onChange={(e) => update("overdue", e.target.checked)}
                        />
                        Overdue only
                    </label>
                </div>
            )}
        </div>
    );
};

/** "Due this week" etc. as concrete, still-open date ranges in the browser's local day. */
const duePresetParams = (preset) => {
    const start = moment().startOf("day");
    const before = (m) => moment(m).subtract(1, "ms").toISOString();
    switch (preset) {
        case "overdue": return { open: "true", dueBefore: before(start) };
        case "today": return { open: "true", dueAfter: start.toISOString(), dueBefore: before(moment(start).add(1, "day")) };
        case "week": return { open: "true", dueAfter: moment().startOf("isoWeek").toISOString(), dueBefore: before(moment().endOf("isoWeek").add(1, "ms")) };
        case "next7": return { open: "true", dueAfter: start.toISOString(), dueBefore: before(moment(start).add(7, "days")) };
        default: return {};
    }
};

/** Turns the filter state into the query params getTasks expects. */
export const toQueryParams = (filters, status) => {
    const [sortBy, sortOrder] = (filters.sort || "createdAt:desc").split(":");
    return {
        status: status === "All" ? "" : status,
        search: filters.search || "",
        priority: filters.priority || "",
        category: filters.category || "",
        tag: filters.tag || "",
        project: filters.project || "",
        assignee: filters.assignee || "",
        department: filters.department || "",
        mine: filters.mine ? "true" : "",
        ...duePresetParams(filters.duePreset),
        // An explicit date range wins over a preset, so existing links keep working.
        ...(filters.dueAfter ? { dueAfter: filters.dueAfter } : {}),
        ...(filters.dueBefore ? { dueBefore: filters.dueBefore } : {}),
        overdue: filters.overdue ? "true" : "",
        sortBy,
        sortOrder,
    };
};

export default TaskFilters;
