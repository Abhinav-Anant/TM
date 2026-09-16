import React, { useEffect, useState } from 'react';
import { LuSearch, LuX, LuFilter } from 'react-icons/lu';
import { PRIORITY_DATA, SORT_OPTIONS } from '../utils/data';

export const EMPTY_FILTERS = {
    search: "",
    priority: "",
    category: "",
    dueAfter: "",
    dueBefore: "",
    overdue: false,
    sort: "createdAt:desc",
};

const SEARCH_DEBOUNCE_MS = 350;

const selectClass =
    "field py-2 cursor-pointer";

/**
 * Search + advanced filter bar. Native <select> and <input type="date"> instead of
 * custom widgets - they are keyboard and screen-reader correct for free.
 */
const TaskFilters = ({ filters, setFilters, categories = [] }) => {
    const [searchText, setSearchText] = useState(filters.search);
    const [expanded, setExpanded] = useState(false);

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
        filters.dueAfter,
        filters.dueBefore,
        filters.overdue ? "y" : "",
    ].filter(Boolean).length;

    const reset = () => {
        setSearchText("");
        setFilters({ ...EMPTY_FILTERS });
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

            {expanded && (
                <div className="enter-fade grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-3 pt-3 border-t border-white/8">
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

/** Turns the filter state into the query params getTasks expects. */
export const toQueryParams = (filters, status) => {
    const [sortBy, sortOrder] = (filters.sort || "createdAt:desc").split(":");
    return {
        status: status === "All" ? "" : status,
        search: filters.search || "",
        priority: filters.priority || "",
        category: filters.category || "",
        dueAfter: filters.dueAfter || "",
        dueBefore: filters.dueBefore || "",
        overdue: filters.overdue ? "true" : "",
        sortBy,
        sortOrder,
    };
};

export default TaskFilters;
