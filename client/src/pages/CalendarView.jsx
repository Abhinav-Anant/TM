import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import toast from 'react-hot-toast';
import { LuChevronLeft, LuChevronRight, LuCalendarDays, LuFlag, LuRepeat } from 'react-icons/lu';
import DashboardLayout from '../components/layouts/DashboardLayout';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import { UserContext } from '../context/userContext';
import { basePathFor, canAssignTasks } from '../utils/roles';

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VIEWS = [["month", "Month"], ["week", "Week"], ["day", "Day"]];
const PRIORITY_DOT = { Urgent: "bg-alert", High: "bg-signal", Medium: "bg-active", Low: "bg-done" };
const KEY = (m) => m.format("YYYY-MM-DD");

/** The days a view shows. Month is a stable 42-cell grid starting on the Monday on or before the 1st. */
const rangeFor = (view, cursor) => {
    if (view === "day") return [cursor.clone().startOf("day")];
    const first = view === "week" ? cursor.clone().startOf("isoWeek") : cursor.clone().startOf("month").startOf("isoWeek");
    return Array.from({ length: view === "week" ? 7 : 42 }, (_, i) => first.clone().add(i, "days"));
};

const titleFor = (view, cursor, days) => {
    if (view === "month") return cursor.format("MMMM YYYY");
    if (view === "day") return cursor.format("dddd, D MMMM YYYY");
    return `${days[0].format("D MMM")} – ${days[6].format("D MMM YYYY")}`;
};

const CalendarView = () => {
    const { user } = useContext(UserContext);
    const navigate = useNavigate();
    const [view, setView] = useState("month");
    const [cursor, setCursor] = useState(() => moment().startOf("day"));
    const [data, setData] = useState({ tasks: [], projects: [], recurring: [] });
    const [loading, setLoading] = useState(false);
    const [selectedDay, setSelectedDay] = useState(() => KEY(moment()));

    const days = useMemo(() => rangeFor(view, cursor), [view, cursor]);
    const rangeStart = KEY(days[0]);
    const rangeEnd = KEY(days[days.length - 1]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                // Only fetch the range the view actually shows.
                const res = await axiosInstance.get(API_PATHS.CALENDAR, {
                    params: {
                        start: moment(rangeStart).startOf("day").toISOString(),
                        end: moment(rangeEnd).endOf("day").toISOString(),
                    },
                });
                if (!cancelled) setData(res.data);
            } catch (error) {
                console.error("Error loading calendar:", error);
                if (!cancelled) toast.error("Could not load the calendar. Try again.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [rangeStart, rangeEnd]);

    const openTask = (id) => {
        if (canAssignTasks(user)) navigate(`${basePathFor(user)}/create-task`, { state: { taskId: id }, viewTransition: true });
        else navigate(`/user/task-details/${id}`, { viewTransition: true });
    };

    // One pass into a day -> items map. Project deadlines first, then tasks, then projected repeats.
    const itemsByDay = useMemo(() => {
        const map = {};
        const add = (date, item) => { (map[KEY(moment(date))] = map[KEY(moment(date))] || []).push(item); };
        data.projects.forEach((p) => add(p.dueDate, { key: `p${p._id}`, kind: "project", title: p.name, onOpen: () => navigate(`/projects/${p._id}`) }));
        data.tasks.forEach((t) => add(t.dueDate, { key: `t${t._id}`, kind: "task", title: t.title, priority: t.priority, status: t.status, repeats: t.recurrence !== "none", onOpen: () => openTask(t._id) }));
        data.recurring.forEach((r) => add(r.dueDate, { key: `r${r.taskId}${r.dueDate}`, kind: "repeat", title: r.title, priority: r.priority, onOpen: () => openTask(r.taskId) }));
        return map;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    const step = (dir) => setCursor((c) => c.clone().add(dir, view === "month" ? "month" : view === "week" ? "week" : "day"));
    const goToday = () => { setCursor(moment().startOf("day")); setSelectedDay(KEY(moment())); };
    const pickDay = (key) => { setSelectedDay(key); if (view === "day") setCursor(moment(key)); };

    const today = KEY(moment());
    const selectedItems = itemsByDay[selectedDay] || [];

    return (
        <DashboardLayout activeMenu="Calendar">
            <div className="py-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2.5 font-display text-2xl text-beam">
                        <LuCalendarDays className="text-ice" /> Calendar
                    </h2>

                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex p-1 rounded-xl panel-sunken" role="group" aria-label="Calendar view">
                            {VIEWS.map(([id, label]) => (
                                <button
                                    key={id} type="button" aria-pressed={view === id}
                                    onClick={() => setView(id)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${view === id ? "bg-signal text-ink" : "text-mist hover:text-beam"}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <button className="btn btn-sm px-2.5" aria-label={`Previous ${view}`} onClick={() => step(-1)}><LuChevronLeft /></button>
                        <span className="text-sm font-medium text-beam min-w-40 text-center num" aria-live="polite">{titleFor(view, cursor, days)}</span>
                        <button className="btn btn-sm px-2.5" aria-label={`Next ${view}`} onClick={() => step(1)}><LuChevronRight /></button>
                        <button className="btn btn-sm" onClick={goToday}>Today</button>
                    </div>
                </div>

                <p className="flex flex-wrap items-center gap-4 text-[11px] text-dusk mt-3">
                    <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-signal" /> Task due</span>
                    <span className="flex items-center gap-1.5"><LuFlag /> Project deadline</span>
                    <span className="flex items-center gap-1.5"><LuRepeat /> Repeats (upcoming)</span>
                </p>

                {view === "month" && (
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mt-4">
                        <div className="lg:col-span-3 panel p-3 overflow-x-auto">
                            <div className="min-w-[640px]">
                                <div className="grid grid-cols-7 gap-1 mb-1">
                                    {WEEKDAYS.map((d) => <div key={d} className="text-[11px] font-medium text-dusk text-center py-1.5">{d}</div>)}
                                </div>
                                <div className="grid grid-cols-7 gap-1">
                                    {days.map((day) => {
                                        const key = KEY(day);
                                        const items = itemsByDay[key] || [];
                                        return (
                                            <button
                                                key={key} type="button" aria-pressed={key === selectedDay}
                                                onClick={() => pickDay(key)}
                                                className={`min-h-[96px] text-left p-1.5 rounded-lg border transition-colors duration-200 cursor-pointer ${key === selectedDay ? "border-signal/50 bg-signal/8" : "border-white/6 hover:border-white/14 hover:bg-white/4"} ${day.month() === cursor.month() ? "" : "opacity-35"}`}
                                            >
                                                <span className={`inline-grid place-items-center w-6 h-6 text-[11px] font-medium rounded-full num ${key === today ? "bg-signal text-ink shadow-[0_0_12px_-2px_rgba(255,176,32,0.9)]" : "text-mist"}`}>
                                                    {day.date()}
                                                </span>
                                                <div className="mt-1.5 space-y-1">
                                                    {items.slice(0, 3).map((item) => <Chip key={item.key} item={item} />)}
                                                    {items.length > 3 && <p className="text-[10px] text-dusk pl-1.5 num">+{items.length - 3} more</p>}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <aside className="panel p-5">
                            <h3 className="font-display text-sm text-beam num">{moment(selectedDay).format("dddd, D MMM YYYY")}</h3>
                            <p className="text-xs text-dusk mt-1 mb-4">{loading ? "Loading" : `${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"}`}</p>
                            <DayList items={selectedItems} loading={loading} />
                        </aside>
                    </div>
                )}

                {view === "week" && (
                    <div className="grid grid-cols-1 md:grid-cols-7 gap-2 mt-4">
                        {days.map((day) => {
                            const key = KEY(day);
                            return (
                                <section key={key} className={`panel p-3 min-h-[140px] ${key === today ? "border-signal/40" : ""}`} aria-label={day.format("dddd D MMMM")}>
                                    <h3 className={`text-xs font-semibold num ${key === today ? "text-signal" : "text-mist"}`}>{day.format("ddd D")}</h3>
                                    <div className="mt-2"><DayList items={itemsByDay[key] || []} loading={loading} compact /></div>
                                </section>
                            );
                        })}
                    </div>
                )}

                {view === "day" && (
                    <div className="panel p-5 mt-4 max-w-2xl">
                        <p className="text-xs text-dusk mb-4">{loading ? "Loading" : `${(itemsByDay[KEY(days[0])] || []).length} item(s)`}</p>
                        <DayList items={itemsByDay[KEY(days[0])] || []} loading={loading} />
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
};

const Chip = ({ item }) => (
    <div
        className={`flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded truncate ${
            item.kind === "project" ? "bg-ice/10 text-ice"
                : item.kind === "repeat" ? "border border-dashed border-white/20 text-dusk"
                    : item.status === "Completed" ? "bg-done/10 text-done line-through" : "bg-white/6 text-mist"
        }`}
        title={item.title}
    >
        {item.kind === "project" ? <LuFlag className="shrink-0" />
            : item.kind === "repeat" ? <LuRepeat className="shrink-0" />
                : <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[item.priority] || "bg-mist"}`} />}
        <span className="truncate">{item.title}</span>
    </div>
);

const DayList = ({ items, loading, compact }) => {
    if (!loading && items.length === 0) return <p className="text-sm text-dusk">{compact ? "–" : "Nothing on this day."}</p>;
    return (
        <ul className="space-y-2 max-h-[520px] overflow-y-auto">
            {items.map((item) => (
                <li key={item.key}>
                    <button
                        type="button" onClick={item.onOpen}
                        className={`w-full text-left panel-sunken rounded-lg hover:bg-white/6 transition-colors cursor-pointer ${compact ? "p-2" : "p-3"} ${item.kind === "repeat" ? "border border-dashed border-white/15" : ""}`}
                    >
                        <div className="flex items-start gap-2">
                            {item.kind === "project" ? <LuFlag className="mt-1 text-ice shrink-0" />
                                : item.kind === "repeat" ? <LuRepeat className="mt-1 text-dusk shrink-0" />
                                    : <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[item.priority] || "bg-mist"}`} />}
                            <div className="min-w-0">
                                <p className="text-[13px] font-medium text-beam truncate">{item.title}</p>
                                <p className="text-[11px] text-dusk mt-0.5">
                                    {item.kind === "project" ? "Project deadline" : item.kind === "repeat" ? "Repeats" : item.status}
                                </p>
                            </div>
                        </div>
                    </button>
                </li>
            ))}
        </ul>
    );
};

export default CalendarView;
