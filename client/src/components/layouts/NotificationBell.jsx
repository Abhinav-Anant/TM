import React, { useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import {
    LuBell, LuCheckCheck, LuX, LuCircleAlert, LuClock,
    LuMessageSquare, LuUserPlus, LuRefreshCw, LuCircleCheck,
} from 'react-icons/lu';
import { NotificationContext } from '../../context/notificationContext';

const TYPE_STYLE = {
    assigned: { icon: LuUserPlus, color: 'text-ice bg-ice/10 border-ice/25' },
    updated: { icon: LuRefreshCw, color: 'text-signal bg-signal/10 border-signal/25' },
    status: { icon: LuCircleCheck, color: 'text-done bg-done/10 border-done/25' },
    comment: { icon: LuMessageSquare, color: 'text-pending bg-pending/10 border-pending/25' },
    deadline: { icon: LuClock, color: 'text-signal bg-signal/10 border-signal/25' },
    overdue: { icon: LuCircleAlert, color: 'text-alert bg-alert/10 border-alert/25' },
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
        const onKey = (e) => e.key === 'Escape' && setOpen(false);
        document.addEventListener('mousedown', onClickOutside);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onClickOutside);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const handleOpenTask = (notification) => {
        if (!notification.read) markAsRead(notification._id);
        setOpen(false);
        const taskId = notification.task?._id || notification.task;
        if (taskId) navigate(`/user/task-details/${taskId}`, { viewTransition: true });
    };

    return (
        <div className="relative" ref={panelRef}>
            <button
                type="button"
                aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
                aria-expanded={open}
                className="relative grid place-items-center w-10 h-10 rounded-lg text-mist hover:text-beam hover:bg-white/6 transition-colors cursor-pointer"
                onClick={() => setOpen((v) => !v)}
            >
                <LuBell className="text-xl" />

                {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 min-w-[17px] h-[17px] px-1 grid place-items-center text-[10px] font-semibold text-void bg-signal rounded-full num shadow-[0_0_10px_1px_rgba(255,176,32,0.6)]">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}

                {/* Live-connection state, shown as a small steady light. */}
                <span
                    className={`absolute bottom-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
                        connected ? 'bg-done shadow-[0_0_6px_1px_rgba(52,211,153,0.8)]' : 'bg-dusk'
                    }`}
                    title={connected ? 'Live updates connected' : 'Reconnecting'}
                />
            </button>

            {open && (
                <div className="enter-drop absolute right-0 mt-2 w-[min(92vw,380px)] panel panel-raised panel-blur z-50 overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/8">
                        <h4 className="font-display text-sm text-beam">Notifications</h4>
                        {unreadCount > 0 && (
                            <button
                                className="flex items-center gap-1.5 text-xs text-ice hover:text-signal transition-colors cursor-pointer"
                                onClick={markAllAsRead}
                            >
                                <LuCheckCheck /> Mark all read
                            </button>
                        )}
                    </div>

                    <div className="max-h-[420px] overflow-y-auto">
                        {notifications.length === 0 ? (
                            <p className="px-4 py-12 text-center text-sm text-dusk">
                                Nothing new. You are up to date.
                            </p>
                        ) : (
                            notifications.map((item) => {
                                const style = TYPE_STYLE[item.type] || TYPE_STYLE.updated;
                                const Icon = style.icon;
                                return (
                                    <div
                                        key={item._id}
                                        role="button"
                                        tabIndex={0}
                                        className={`group flex gap-3 px-4 py-3 border-b border-white/5 cursor-pointer transition-colors hover:bg-white/5 ${
                                            item.read ? '' : 'bg-signal/6'
                                        }`}
                                        onClick={() => handleOpenTask(item)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleOpenTask(item);
                                        }}
                                    >
                                        <span className={`w-8 h-8 shrink-0 rounded-lg grid place-items-center border ${style.color}`}>
                                            <Icon className="text-sm" />
                                        </span>

                                        <div className="flex-1 min-w-0">
                                            <p className="text-[13px] font-medium text-beam truncate">{item.title}</p>
                                            {item.message && (
                                                <p className="text-xs text-mist line-clamp-2 mt-0.5">{item.message}</p>
                                            )}
                                            <p className="text-[11px] text-dusk mt-1">{moment(item.createdAt).fromNow()}</p>
                                        </div>

                                        <button
                                            className="text-dusk hover:text-alert opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer self-start"
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
