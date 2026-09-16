import React from 'react';

/** Shared tooltip for every chart, so hover reads the same everywhere. */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;

  const heading = payload[0]?.name ?? payload[0]?.payload?.priority ?? label;

  return (
    <div className="panel panel-raised panel-blur px-3 py-2 text-xs">
      <p className="text-beam font-medium mb-1">{heading}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey ?? entry.name} className="flex items-center gap-2 text-mist">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color ?? entry.payload?.fill }}
          />
          {/* Text wears text tokens; the dot carries the identity. */}
          <span>{entry.name}</span>
          <span className="text-beam num ml-auto pl-3">{entry.value}</span>
        </p>
      ))}
    </div>
  );
};

export default CustomTooltip;
