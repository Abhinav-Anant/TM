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

const PRIORITY_DOT = { High: "bg-rose-500", Medium: "bg-amber-500", Low: "bg-emerald-500" };

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
                toast.error("Failed to load calendar.");
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
        if (canAssignTasks(user)) navigate(`${basePathFor(user)}/create-task`, { state: { taskId: task._id } });
        else navigate(`/user/task-details/${task._id}`);
    };

    const today = moment().format("YYYY-MM-DD");
    const selectedTasks = tasksByDay[selectedDay] || [];

    return (
        <DashboardLayout activeMenu="Calendar">
            <div className="my-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-xl font-medium">
                        <LuCalendarDays /> Task Calendar
                    </h2>

                    <div className="flex items-center gap-2">
                        <button
                            className="p-2 rounded-md border border-slate-200 hover:bg-gray-50 cursor-pointer"
                            aria-label="Previous month"
                            onClick={() => setMonth((m) => m.clone().subtract(1, "month"))}
                        >
                            <LuChevronLeft />
                        </button>
                        <span className="text-sm font-medium w-36 text-center">{month.format("MMMM YYYY")}</span>
                        <button
                            className="p-2 rounded-md border border-slate-200 hover:bg-gray-50 cursor-pointer"
                            aria-label="Next month"
                            onClick={() => setMonth((m) => m.clone().add(1, "month"))}
                        >
                            <LuChevronRight />
                        </button>
                        <button
                            className="text-sm px-3 py-2 rounded-md border border-slate-200 hover:bg-gray-50 cursor-pointer"
                            onClick={() => {
                                setMonth(moment().startOf("month"));
                                setSelectedDay(today);
                            }}
                        >
                            Today
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mt-4">
                    <div className="lg:col-span-3 bg-white border border-gray-200/70 rounded-lg p-3 overflow-x-auto">
                        <div className="min-w-[640px]">
                            <div className="grid grid-cols-7 gap-1 mb-1">
                                {WEEKDAYS.map((d) => (
                                    <div key={d} className="text-[11px] font-semibold text-gray-400 text-center py-1">
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
                                            onClick={() => setSelectedDay(key)}
                                            className={`min-h-[92px] text-left p-1.5 rounded-md border transition-colors cursor-pointer ${
                                                isSelected ? "border-blue-400 bg-blue-50/50" : "border-gray-100 hover:bg-gray-50"
                                            } ${inMonth ? "" : "opacity-40"}`}
                                        >
                                            <span
                                                className={`inline-flex items-center justify-center w-6 h-6 text-[11px] font-medium rounded-full ${
                                                    isToday ? "bg-blue-600 text-white" : "text-gray-600"
                                                }`}
                                            >
                                                {day.date()}
                                            </span>

                                            <div className="mt-1 space-y-0.5">
                                                {dayTasks.slice(0, 3).map((task) => (
                                                    <div
                                                        key={task._id}
                                                        className={`flex items-center gap-1 text-[10px] px-1 py-0.5 rounded truncate ${
                                                            task.status === "Completed"
                                                                ? "bg-lime-50 text-lime-700 line-through"
                                                                : "bg-gray-100 text-gray-700"
                                                        }`}
                                                        title={task.title}
                                                    >
                                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] || "bg-gray-400"}`} />
                                                        <span className="truncate">{task.title}</span>
                                                    </div>
                                                ))}
                                                {dayTasks.length > 3 && (
                                                    <p className="text-[10px] text-gray-400 pl-1">+{dayTasks.length - 3} more</p>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="bg-white border border-gray-200/70 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-gray-800">
                            {moment(selectedDay).format("dddd, Do MMM YYYY")}
                        </h3>
                        <p className="text-xs text-gray-400 mb-3">
                            {loading ? "Loading..." : `${selectedTasks.length} task${selectedTasks.length === 1 ? "" : "s"} due`}
                        </p>

                        <div className="space-y-2 max-h-[520px] overflow-y-auto">
                            {selectedTasks.map((task) => (
                                <button
                                    key={task._id}
                                    type="button"
                                    onClick={() => openTask(task)}
                                    className="w-full text-left border border-gray-100 rounded-md p-2.5 hover:border-blue-200 hover:bg-blue-50/30 cursor-pointer"
                                >
                                    <div className="flex items-start gap-2">
                                        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] || "bg-gray-400"}`} />
                                        <div className="min-w-0">
                                            <p className="text-[13px] font-medium text-gray-800 truncate">{task.title}</p>
                                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${categoryColor(task.category || "General")}`}>
                                                    {task.category || "General"}
                                                </span>
                                                <span className="text-[10px] text-gray-500">{task.status}</span>
                                                <span className="text-[10px] text-gray-400">{task.progress || 0}%</span>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            ))}

                            {!loading && selectedTasks.length === 0 && (
                                <p className="text-[13px] text-gray-400">Nothing due on this day.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
};

export default CalendarView;
