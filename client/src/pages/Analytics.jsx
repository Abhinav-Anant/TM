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
import { categoryColor } from '../utils/data';

const STATUS_COLORS = ["#8D51FF", "#00B8DB", "#7BCE00"];
const RANGES = [7, 30, 90];

const StatTile = ({ icon, label, value, suffix = "", tone }) => {
    const Icon = icon;
    return (
    <div className="bg-white border border-gray-200/70 rounded-lg p-4">
        <div className="flex items-center gap-2 text-gray-500">
            <Icon className={`text-lg ${tone}`} />
            <span className="text-xs font-medium">{label}</span>
        </div>
        <p className="text-2xl font-semibold text-gray-900 mt-2">
            {value}
            <span className="text-sm font-normal text-gray-400">{suffix}</span>
        </p>
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
                toast.error("Failed to load analytics.");
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

    return (
        <DashboardLayout activeMenu="Analytics">
            <div className="my-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-xl font-medium">
                        <LuChartColumnBig /> Progress &amp; Analytics
                    </h2>

                    <div className="flex items-center gap-1 bg-gray-100 rounded-md p-1">
                        {RANGES.map((range) => (
                            <button
                                key={range}
                                className={`text-xs px-3 py-1.5 rounded cursor-pointer ${
                                    days === range ? "bg-white shadow-sm font-medium text-gray-900" : "text-gray-500"
                                }`}
                                onClick={() => setDays(range)}
                            >
                                {range}d
                            </button>
                        ))}
                    </div>
                </div>

                {loading && !data ? (
                    <p className="text-sm text-gray-400 mt-10">Loading analytics...</p>
                ) : (
                    <>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                            <StatTile icon={LuListChecks} label="Total tasks" value={totals.all ?? 0} tone="text-blue-500" />
                            <StatTile icon={LuCircleCheck} label="Completion rate" value={totals.completionRate ?? 0} suffix="%" tone="text-lime-600" />
                            <StatTile icon={LuGauge} label="Average progress" value={totals.avgProgress ?? 0} suffix="%" tone="text-violet-500" />
                            <StatTile icon={LuTriangleAlert} label="Overdue" value={totals.overdue ?? 0} tone="text-rose-500" />
                        </div>

                        <div className="bg-white border border-gray-200/70 rounded-lg p-4 mt-4">
                            <h3 className="text-sm font-semibold text-gray-800">Created vs completed</h3>
                            <ResponsiveContainer width="100%" height={280}>
                                <AreaChart data={trend} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="createdFill" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#8D51FF" stopOpacity={0.35} />
                                            <stop offset="95%" stopColor="#8D51FF" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="completedFill" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#7BCE00" stopOpacity={0.35} />
                                            <stop offset="95%" stopColor="#7BCE00" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                                    <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#CBD5E1" interval="preserveStartEnd" minTickGap={24} />
                                    <YAxis tick={{ fontSize: 11 }} stroke="#CBD5E1" allowDecimals={false} />
                                    <Tooltip />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Area type="monotone" dataKey="created" stroke="#8D51FF" fill="url(#createdFill)" strokeWidth={2} />
                                    <Area type="monotone" dataKey="completed" stroke="#7BCE00" fill="url(#completedFill)" strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                            <div className="bg-white border border-gray-200/70 rounded-lg p-4">
                                <h3 className="text-sm font-semibold text-gray-800">Tasks by status</h3>
                                <CustomPieChart data={data?.byStatus || []} colors={STATUS_COLORS} />
                            </div>

                            <div className="bg-white border border-gray-200/70 rounded-lg p-4">
                                <h3 className="text-sm font-semibold text-gray-800">Tasks by priority</h3>
                                <CustomBarChart data={data?.byPriority || []} />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                            <div className="bg-white border border-gray-200/70 rounded-lg p-4">
                                <h3 className="text-sm font-semibold text-gray-800 mb-3">Progress by category</h3>
                                {(data?.byCategory || []).length === 0 && (
                                    <p className="text-sm text-gray-400">No tasks yet.</p>
                                )}
                                <div className="space-y-3">
                                    {(data?.byCategory || []).map((row) => (
                                        <div key={row.category}>
                                            <div className="flex items-center justify-between text-xs mb-1">
                                                <span className={`px-2 py-0.5 rounded border ${categoryColor(row.category)}`}>
                                                    {row.category}
                                                </span>
                                                <span className="text-gray-500">
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

                            <div className="bg-white border border-gray-200/70 rounded-lg p-4">
                                <h3 className="text-sm font-semibold text-gray-800 mb-3">Next deadlines</h3>
                                {(data?.upcoming || []).length === 0 && (
                                    <p className="text-sm text-gray-400">Nothing scheduled.</p>
                                )}
                                <div className="space-y-2">
                                    {(data?.upcoming || []).map((task) => (
                                        <button
                                            key={task._id}
                                            type="button"
                                            onClick={() => navigate(`/user/task-details/${task._id}`)}
                                            className="w-full flex items-center justify-between gap-3 text-left border border-gray-100 rounded-md px-3 py-2 hover:bg-gray-50 cursor-pointer"
                                        >
                                            <div className="min-w-0">
                                                <p className="text-[13px] font-medium text-gray-800 truncate">{task.title}</p>
                                                <p className="text-[11px] text-gray-400">{task.category || "General"} &middot; {task.priority}</p>
                                            </div>
                                            <span className="text-[11px] text-gray-500 whitespace-nowrap">
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
