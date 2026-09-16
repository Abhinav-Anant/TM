import React from 'react';
import { statusFill, statusText } from '../../utils/data';

const Progress = ({ progress = 0, status }) => {
    const value = Math.max(0, Math.min(100, Number(progress) || 0));

    return (
        <div
            className="w-full h-1.5 rounded-full bg-white/8 overflow-hidden"
            role="progressbar"
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div
                className={`h-full rounded-full ${statusFill(status)} ${statusText(status)} transition-[width] duration-700 ease-out`}
                style={{
                    width: `${value}%`,
                    // The bar glows in its own colour, so progress reads at a glance
                    // even in peripheral vision.
                    boxShadow: '0 0 12px 0 currentColor',
                }}
            />
        </div>
    );
};

export default Progress;
