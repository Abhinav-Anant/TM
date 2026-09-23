import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import toast from 'react-hot-toast';
import { LuChevronLeft, LuChevronRight, LuCalendarDays } from 'react-icons/lu';
import DashboardLayout from '../components/layouts/DashboardLayout';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import { UserContext } from '../context/userContext';
import { categoryColor } from '../utils/data';
import { basePathFor, canAssignTasks } from '../utils/roles';

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PRIORITY_DOT = { High: "bg-alert", Medium: "bg-signal", Low: "bg-done" };

/** Six full weeks starting on the Monday on or before the 1st - a stable 42-cell grid. */
const buildGrid = (month) => {
    const start = month.clone().startOf("month").startOf("isoWeek");
    return Array.from({ length: 42 }, (_, i) => start.clone().add(i, "days"));
};

const CalendarView = () => {
    const { user } = useContext(UserContext);
    const navigate = useNavigate();
    const [month, setMonth] = useState(() => moment().startOf("month"));
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedDay, setSelectedDay] = useState(() => moment().format("YYYY-MM-DD"));

    const days = useMemo(() => buildGrid(month), [month]);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                // Only fetch the range the grid actually shows.
                const { data } = await axiosInstance.get(API_PATHS.TASKS.GET_ALL_TASKS, {
                    params: {
                        dueAfter: days[0].format("YYYY-MM-DD"),
                        dueBefore: days[days.length - 1].format("YYYY-MM-DD"),
                        sortBy: "dueDate",
                        sortOrder: "asc",
                    },
                });
                setTasks(data?.tasks || []);
            } catch (error) {
                console.error("Error loading calendar tasks:", error);
                toast.error("Could not load the calendar. Try again.");
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [days]);

    // One pass into a day -> tasks map instead of filtering inside every cell.
    const tasksByDay = useMemo(() => {
        const map = {};
        tasks.forEach((task) => {
            const key = moment(task.dueDate).format("YYYY-MM-DD");
            (map[key] = map[key] || []).push(task);
        });
        return map;
    }, [tasks]);

    const openTask = (task) => {
        if (canAssignTasks(user)) navigate(`${basePathFor(user)}/create-task`, { state: { taskId: task._id }, viewTransition: true });
        else navigate(`/user/task-details/${task._id}`, { viewTransition: true });
    };

    const today = moment().format("YYYY-MM-DD");
    const selectedTasks = tasksByDay[selectedDay] || [];

    return (
        <DashboardLayout activeMenu="Calendar">
            <div className="py-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2.5 font-display text-2xl text-beam">
                        <LuCalendarDays className="text-ice" /> Calendar
                    </h2>

                    <div className="flex items-center gap-2">
                        <button
                            className="btn btn-sm px-2.5"
                            aria-label="Previous month"
                            onClick={() => setMonth((m) => m.clone().subtract(1, "month"))}
                        >
                            <LuChevronLeft />
                        </button>
                        <span className="text-sm font-medium text-beam w-36 text-center num">
                            {month.format("MMMM YYYY")}
                        </span>
                        <button
                            className="btn btn-sm px-2.5"
                            aria-label="Next month"
                            onClick={() => setMonth((m) => m.clone().add(1, "month"))}
                        >
                            <LuChevronRight />
                        </button>
                        <button
                            className="btn btn-sm"
                            onClick={() => {
                                setMonth(moment().startOf("month"));
                                setSelectedDay(today);
                            }}
                        >
                            Today
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mt-5">
                    <div className="lg:col-span-3 panel p-3 overflow-x-auto">
                        <div className="min-w-[640px]">
                            <div className="grid grid-cols-7 gap-1 mb-1">
                                {WEEKDAYS.map((d) => (
                                    <div key={d} className="text-[11px] font-medium text-dusk text-center py-1.5">
                                        {d}
                                    </div>
                                ))}
                            </div>

                            <div className="grid grid-cols-7 gap-1">
                                {days.map((day) => {
                                    const key = day.format("YYYY-MM-DD");
                                    const dayTasks = tasksByDay[key] || [];
                                    const inMonth = day.month() === month.month();
                                    const isToday = key === today;
                                    const isSelected = key === selectedDay;

                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            aria-pressed={isSelected}
                                            onClick={() => setSelectedDay(key)}
                                            className={`min-h-[96px] text-left p-1.5 rounded-lg border transition-colors duration-200 cursor-pointer ${
                                                isSelected
                                                    ? "border-signal/50 bg-signal/8"
                                                    : "border-white/6 hover:border-white/14 hover:bg-white/4"
                                            } ${inMonth ? "" : "opacity-35"}`}
                                        >
                                            <span
                                                className={`inline-grid place-items-center w-6 h-6 text-[11px] font-medium rounded-full num ${
                                                    isToday
                                                        ? "bg-signal text-ink shadow-[0_0_12px_-2px_rgba(255,176,32,0.9)]"
                                                        : "text-mist"
                                                }`}
                                            >
                                                {day.date()}
                                            </span>

                                            <div className="mt-1.5 space-y-1">
                                                {dayTasks.slice(0, 3).map((task) => (
                                                    <div
                                                        key={task._id}
                                                        className={`flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded truncate ${
                                                            task.status === "Completed"
                                                                ? "bg-done/10 text-done line-through"
                                                                : "bg-white/6 text-mist"
                                                        }`}
                                                        title={task.title}
                                                    >
                                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] || "bg-mist"}`} />
                                                        <span className="truncate">{task.title}</span>
                                                    </div>
                                                ))}
                                                {dayTasks.length > 3 && (
                                                    <p className="text-[10px] text-dusk pl-1.5 num">
                                                        +{dayTasks.length - 3} more
                                                    </p>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="panel p-5">
                        <h3 className="font-display text-sm text-beam num">
                            {moment(selectedDay).format("dddd, D MMM YYYY")}
                        </h3>
                        <p className="text-xs text-dusk mt-1 mb-4">
                            {loading
                                ? "Loading"
                                : `${selectedTasks.length} task${selectedTasks.length === 1 ? "" : "s"} due`}
                        </p>

                        <div className="space-y-2 max-h-[520px] overflow-y-auto">
                            {selectedTasks.map((task) => (
                                <button
                                    key={task._id}
                                    type="button"
                                    onClick={() => openTask(task)}
                                    className="w-full text-left panel-sunken rounded-lg p-3 hover:bg-white/6 border-transparent hover:border-white/12 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-start gap-2.5">
                                        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] || "bg-mist"}`} />
                                        <div className="min-w-0">
                                            <p className="text-[13px] font-medium text-beam truncate">{task.title}</p>
                                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                                <span className={`chip border ${categoryColor(task.category || "General")}`}>
                                                    {task.category || "General"}
                                                </span>
                                                <span className="text-[11px] text-mist">{task.status}</span>
                                                <span className="text-[11px] text-dusk num">{task.progress || 0}%</span>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            ))}

                            {!loading && selectedTasks.length === 0 && (
                                <p className="text-sm text-dusk">Nothing due on this day.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
};

export default CalendarView;
