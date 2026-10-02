import React from 'react';
import { tilt } from '../../utils/tilt';
import { statusFill, statusText } from '../../utils/data';

const StatCell = ({ label, count, status }) => (
    <div className="flex-1 panel-sunken rounded-lg px-3 py-2.5">
        <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${statusFill(status)}`} />
            <span className={`font-display text-lg num ${statusText(status)}`}>{count}</span>
        </div>
        <p className="text-[11px] text-dusk mt-0.5">{label}</p>
    </div>
);

const UserCard = ({ userInfo }) => {
    const initial = (userInfo?.name || '?').trim().charAt(0).toUpperCase();

    return (
        <div className="panel tilt relative overflow-hidden p-4" {...tilt}>
            <span className="tilt-gloss" />

            <div className="relative tilt-layer">
                <div className="flex items-center gap-3">
                    {userInfo?.profileImageUrl ? (
                        <img
                            src={userInfo.profileImageUrl}
                            alt=""
                            className="w-11 h-11 rounded-full object-cover border border-white/12"
                        />
                    ) : (
                        <div className="w-11 h-11 rounded-full grid place-items-center bg-deck border border-white/10 font-display text-ice">
                            {initial}
                        </div>
                    )}

                    <div className="min-w-0">
                        <p className="text-sm font-medium text-beam truncate">{userInfo?.name}</p>
                        <p className="text-xs text-dusk truncate">{userInfo?.email}</p>
                    </div>
                </div>

                <div className="flex items-stretch gap-2 mt-4">
                    <StatCell label="To do" count={userInfo?.pendingTasks || 0} status="To Do" />
                    <StatCell label="In progress" count={userInfo?.inProgressTasks || 0} status="In Progress" />
                    <StatCell label="Completed" count={userInfo?.completedTasks || 0} status="Completed" />
                </div>
            </div>
        </div>
    );
};

export default UserCard;
