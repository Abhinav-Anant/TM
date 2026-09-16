import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import CustomTooltip from './CustomTooltip';
import CustomLegend from './CustomLegend';
import { STATUS_CHART_COLORS } from '../../utils/data';

const CustomPieChart = ({ data, colors = STATUS_CHART_COLORS }) => {
    if (!data || data.length === 0) {
        return <p className="text-sm text-dusk py-16 text-center">No tasks to chart yet.</p>;
    }

    const total = data.reduce((sum, item) => sum + (item.count || 0), 0);

    return (
        <div className="relative">
            <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                    <Pie
                        data={data}
                        dataKey="count"
                        nameKey="status"
                        cx="50%"
                        cy="45%"
                        outerRadius={104}
                        innerRadius={76}
                        /* A 2px surface gap between segments, so adjacent fills
                           never touch and read as one mass. */
                        paddingAngle={2}
                        stroke="none"
                        labelLine={false}
                    >
                        {data.map((entry, index) => (
                            <Cell key={entry.status} fill={colors[index % colors.length]} />
                        ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend content={<CustomLegend />} />
                </PieChart>
            </ResponsiveContainer>

            {/* The total belongs in the hole - it is the one number the donut
                cannot show, and it saves a separate stat tile. */}
            <div className="absolute inset-x-0 top-[45%] -translate-y-1/2 pointer-events-none text-center">
                <p className="font-display text-3xl text-beam num leading-none">{total}</p>
                <p className="text-[11px] text-dusk mt-1">total</p>
            </div>
        </div>
    );
};

export default CustomPieChart;
