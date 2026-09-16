import React from 'react';
import { tilt } from '../../utils/tilt';

/**
 * A single reading on the panel. The value carries the weight; the colour bar
 * is the only decoration, and it is doing work - it ties the number to the
 * same status hue used on every card and chart.
 */
const InfoCard = ({ icon, label, value, color = 'bg-ice', tone = 'text-ice' }) => (
  <div className="panel tilt relative overflow-hidden p-4" {...tilt}>
    <span className="tilt-gloss" />
    <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${color}`} />

    <div className="relative tilt-layer">
      <div className="flex items-center gap-2 text-xs text-mist">
        {icon && <span className={tone}>{icon}</span>}
        <span>{label}</span>
      </div>
      <p className="font-display text-3xl text-beam mt-2 num leading-none">{value}</p>
    </div>
  </div>
);

export default InfoCard;
