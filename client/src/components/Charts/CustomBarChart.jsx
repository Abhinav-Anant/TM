import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import CustomTooltip from './CustomTooltip';
import { PRIORITY_CHART_COLORS, CHART_INK } from '../../utils/data';

const CustomBarChart = ({ data = [] }) => {
  if (data.length === 0) {
    return <p className="text-sm text-dusk py-16 text-center">No tasks to chart yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 24, right: 8, left: -24, bottom: 0 }}>
        {/* Horizontal rules only - vertical ones fight the bars they sit behind. */}
        <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
        <XAxis
          dataKey="priority"
          tick={{ fontSize: 12, fill: CHART_INK.label }}
          tickLine={false}
          axisLine={{ stroke: CHART_INK.grid }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: CHART_INK.label }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={44}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148,178,255,0.05)' }} />
        <Bar dataKey="count" name="Tasks" radius={[4, 4, 0, 0]} maxBarSize={56}>
          {data.map((entry) => (
            <Cell key={entry.priority} fill={PRIORITY_CHART_COLORS[entry.priority] || '#0369a1'} />
          ))}
          {/* Three bars is few enough to label every one directly - and it is
              the secondary encoding the priority palette relies on. */}
          <LabelList
            dataKey="count"
            position="top"
            offset={8}
            style={{ fill: '#eaf1ff', fontSize: 12 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

export default CustomBarChart;
