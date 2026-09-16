import React from 'react';

const CustomLegend = ({ payload = [] }) => (
  <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 mt-4">
    {payload.map((entry) => (
      <div key={entry.value} className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
        <span className="text-xs text-mist">{entry.value}</span>
      </div>
    ))}
  </div>
);

export default CustomLegend;
