import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import toast from 'react-hot-toast';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { LuChartColumnBig, LuTriangleAlert, LuCircleCheck, LuListChecks, LuGauge } from 'react-icons/lu';
import DashboardLayout from '../components/layouts/DashboardLayout';
import CustomPieChart from '../components/Charts/CustomPieChart';
import CustomBarChart from '../components/Charts/CustomBarChart';
import Progress from '../components/layouts/Progress';
import axiosInstance from '../utils/axiosInstance';
import { API_PATHS } from '../utils/apiPaths';
import { categoryColor, STATUS_CHART_COLORS, CHART_INK } from '../utils/data';
import CustomTooltip from '../components/Charts/CustomTooltip';
import { tilt } from '../utils/tilt';

const RANGES = [7, 30, 90];

const StatTile = ({ icon, label, value, suffix = "", tone, bar }) => {
    const Icon = icon;
    return (
        <div className="panel tilt relative overflow-hidden p-4" {...tilt}>
            <span className="tilt-gloss" />
            <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${bar}`} />

            <div className="relative tilt-layer">
                <div className="flex items-center gap-2 text-mist">
                    <Icon className={`text-base ${tone}`} />
                    <span className="text-xs font-medium">{label}</span>
                </div>
                <p className="font-display text-3xl text-beam mt-2 num leading-none">
                    {value}
                    <span className="text-lg text-dusk">{suffix}</span>
                </p>
            </div>
        </div>
    );
};

const Analytics = () => {
    const [data, setData] = useState(null);
    const [days, setDays] = useState(30);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const response = await axiosInstance.get(API_PATHS.TASKS.GET_ANALYTICS, { params: { days } });
                setData(response.data);
            } catch (error) {
                console.error("Error loading analytics:", error);
                toast.error("Could not load analytics. Try again.");
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [days]);

    const totals = data?.totals || {};
    const trend = (data?.trend || []).map((point) => ({
        ...point,
        label: moment(point.date).format("D MMM"),
    }));

    // Server groups byStatus alphabetically by _id, not in the fixed status order
    // the chart colours are indexed by - reorder before handing it to the pie.
    const STATUS_ORDER = ["Pending", "In Progress", "In Review", "Completed"];
    const byStatusCounts = Object.fromEntries((data?.byStatus || []).map((g) => [g.status, g.count]));
    const byStatus = STATUS_ORDER
        .filter((status) => byStatusCounts[status] !== undefined)
        .map((status) => ({ status, count: byStatusCounts[status] }));

    return (
        <DashboardLayout activeMenu="Analytics">
            <div className="py-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2.5 font-display text-2xl text-beam">
                        <LuChartColumnBig className="text-ice" /> Progress
                    </h2>

                    <div className="flex items-center gap-1 p-1 rounded-xl panel-sunken">
                        {RANGES.map((range) => (
                            <button
                                key={range}
                                aria-pressed={days === range}
                                className={`relative text-xs px-3.5 py-1.5 rounded-lg cursor-pointer transition-colors num ${
                                    days === range ? "text-ink" : "text-mist hover:text-beam"
                                }`}
                                onClick={() => setDays(range)}
                            >
                                {days === range && (
                                    <span className="absolute inset-0 rounded-lg bg-signal shadow-[0_6px_20px_-8px_rgba(255,176,32,0.9)]" />
                                )}
                                <span className="relative">Last {range} days</span>
                            </button>
                        ))}
                    </div>
                </div>

                {loading && !data ? (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
                        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
                            <StatTile icon={LuListChecks} label="Total tasks" value={totals.all ?? 0} tone="text-ice" bar="bg-ice" />
                            <StatTile icon={LuCircleCheck} label="Completion rate" value={totals.completionRate ?? 0} suffix="%" tone="text-done" bar="bg-done" />
                            <StatTile icon={LuGauge} label="Average progress" value={totals.avgProgress ?? 0} suffix="%" tone="text-pending" bar="bg-pending" />
                            <StatTile icon={LuTriangleAlert} label="Overdue" value={totals.overdue ?? 0} tone="text-alert" bar="bg-alert" />
                        </div>

                        <div className="panel p-6 mt-4">
                            <h3 className="font-display text-base text-beam">Created against completed</h3>
                            <p className="text-sm text-mist mt-1 mb-4">
                                Work coming in versus work going out over the last {days} days.
                            </p>
                            <ResponsiveContainer width="100%" height={280}>
                                <AreaChart data={trend} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="createdFill" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={STATUS_CHART_COLORS[0]} stopOpacity={0.45} />
                                            <stop offset="95%" stopColor={STATUS_CHART_COLORS[0]} stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="completedFill" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={STATUS_CHART_COLORS[3]} stopOpacity={0.45} />
                                            <stop offset="95%" stopColor={STATUS_CHART_COLORS[3]} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
                                    <XAxis
                                        dataKey="label"
                                        tick={{ fontSize: 11, fill: CHART_INK.label }}
                                        tickLine={false}
                                        axisLine={{ stroke: CHART_INK.grid }}
                                        interval="preserveStartEnd"
                                        minTickGap={24}
                                    />
                                    <YAxis
                                        tick={{ fontSize: 11, fill: CHART_INK.label }}
                                        tickLine={false}
                                        axisLine={false}
                                        allowDecimals={false}
                                        width={44}
                                    />
                                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: CHART_INK.axis, strokeDasharray: '4 4' }} />
                                    <Legend wrapperStyle={{ fontSize: 12, color: CHART_INK.label }} iconType="square" iconSize={10} />
                                    <Area type="monotone" name="Created" dataKey="created" stroke={STATUS_CHART_COLORS[0]} fill="url(#createdFill)" strokeWidth={2} />
                                    <Area type="monotone" name="Completed" dataKey="completed" stroke={STATUS_CHART_COLORS[3]} fill="url(#completedFill)" strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                            <div className="panel p-6">
                                <h3 className="font-display text-base text-beam">Tasks by status</h3>
                                <CustomPieChart data={byStatus} />
                            </div>

                            <div className="panel p-6">
                                <h3 className="font-display text-base text-beam">Tasks by priority</h3>
                                <div className="mt-6">
                                    <CustomBarChart data={data?.byPriority || []} />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                            <div className="panel p-6">
                                <h3 className="font-display text-base text-beam mb-4">Progress by category</h3>
                                {(data?.byCategory || []).length === 0 && (
                                    <p className="text-sm text-dusk">No tasks yet.</p>
                                )}
                                <div className="space-y-4">
                                    {(data?.byCategory || []).map((row) => (
                                        <div key={row.category}>
                                            <div className="flex items-center justify-between gap-3 text-xs mb-2">
                                                <span className={`chip border ${categoryColor(row.category)}`}>
                                                    {row.category}
                                                </span>
                                                <span className="text-mist num">
                                                    {row.completed}/{row.count} done &middot; {row.avgProgress}%
                                                </span>
                                            </div>
                                            <Progress
                                                progress={row.avgProgress}
                                                status={row.completed === row.count ? "Completed" : "In Progress"}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="panel p-6">
                                <h3 className="font-display text-base text-beam mb-4">Next deadlines</h3>
                                {(data?.upcoming || []).length === 0 && (
                                    <p className="text-sm text-dusk">Nothing scheduled.</p>
                                )}
                                <div className="space-y-2">
                                    {(data?.upcoming || []).map((task) => (
                                        <button
                                            key={task._id}
                                            type="button"
                                            onClick={() => navigate(`/user/task-details/${task._id}`, { viewTransition: true })}
                                            className="w-full flex items-center justify-between gap-3 text-left panel-sunken rounded-lg px-3.5 py-2.5 hover:bg-white/6 transition-colors cursor-pointer"
                                        >
                                            <div className="min-w-0">
                                                <p className="text-[13px] font-medium text-beam truncate">{task.title}</p>
                                                <p className="text-[11px] text-dusk mt-0.5">
                                                    {task.category || "General"} &middot; {task.priority}
                                                </p>
                                            </div>
                                            <span className="text-[11px] text-mist whitespace-nowrap num">
                                                {moment(task.dueDate).fromNow()}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </DashboardLayout>
    );
};

export default Analytics;
