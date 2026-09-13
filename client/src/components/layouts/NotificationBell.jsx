import React, { useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import {
    LuBell, LuCheckCheck, LuX, LuCircleAlert, LuClock,
    LuMessageSquare, LuUserPlus, LuRefreshCw, LuCircleCheck,
} from 'react-icons/lu';
import { NotificationContext } from '../../context/notificationContext';

const TYPE_STYLE = {
    assigned: { icon: LuUserPlus, color: "text-blue-500 bg-blue-50" },
    updated: { icon: LuRefreshCw, color: "text-amber-500 bg-amber-50" },
    status: { icon: LuCircleCheck, color: "text-lime-600 bg-lime-50" },
    comment: { icon: LuMessageSquare, color: "text-violet-500 bg-violet-50" },
    deadline: { icon: LuClock, color: "text-orange-500 bg-orange-50" },
    overdue: { icon: LuCircleAlert, color: "text-rose-500 bg-rose-50" },
};

const NotificationBell = () => {
    const { notifications, unreadCount, connected, markAsRead, markAllAsRead, removeNotification } =
        useContext(NotificationContext);
    const [open, setOpen] = useState(false);
    const panelRef = useRef(null);
    const navigate = useNavigate();

    useEffect(() => {
        if (!open) return undefined;
        const onClickOutside = (e) => {
            if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener("mousedown", onClickOutside);
        return () => document.removeEventListener("mousedown", onClickOutside);
    }, [open]);

    const handleOpenTask = (notification) => {
        if (!notification.read) markAsRead(notification._id);
        setOpen(false);
        const taskId = notification.task?._id || notification.task;
        if (taskId) navigate(`/user/task-details/${taskId}`);
    };

    return (
        <div className="relative" ref={panelRef}>
            <button
                type="button"
                aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
                className="relative p-2 rounded-full hover:bg-gray-100 cursor-pointer"
                onClick={() => setOpen((v) => !v)}
            >
                <LuBell className="text-xl text-gray-700" />
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-semibold text-white bg-rose-500 rounded-full">
                        {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                )}
                <span
                    className={`absolute bottom-1 right-1 w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-gray-300"}`}
                    title={connected ? "Live updates connected" : "Reconnecting..."}
                />
            </button>

            {open && (
                <div className="absolute right-0 mt-2 w-[min(92vw,380px)] bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <h4 className="text-sm font-semibold text-gray-800">Notifications</h4>
                        {unreadCount > 0 && (
                            <button
                                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 cursor-pointer"
                                onClick={markAllAsRead}
                            >
                                <LuCheckCheck /> Mark all read
                            </button>
                        )}
                    </div>

                    <div className="max-h-[420px] overflow-y-auto">
                        {notifications.length === 0 ? (
                            <p className="px-4 py-10 text-center text-sm text-gray-400">You're all caught up.</p>
                        ) : (
                            notifications.map((item) => {
                                const style = TYPE_STYLE[item.type] || TYPE_STYLE.updated;
                                const Icon = style.icon;
                                return (
                                    <div
                                        key={item._id}
                                        className={`flex gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${item.read ? "" : "bg-blue-50/40"}`}
                                        onClick={() => handleOpenTask(item)}
                                    >
                                        <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${style.color}`}>
                                            <Icon className="text-sm" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[13px] font-medium text-gray-800 truncate">{item.title}</p>
                                            {item.message && (
                                                <p className="text-xs text-gray-500 line-clamp-2">{item.message}</p>
                                            )}
                                            <p className="text-[11px] text-gray-400 mt-1">{moment(item.createdAt).fromNow()}</p>
                                        </div>
                                        <button
                                            className="text-gray-300 hover:text-rose-500 cursor-pointer"
                                            aria-label="Dismiss notification"
                                            onClick={(e) => { e.stopPropagation(); removeNotification(item._id); }}
                                        >
                                            <LuX />
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationBell;
