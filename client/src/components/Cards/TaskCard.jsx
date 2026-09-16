import React from 'react';
import moment from 'moment';
import Progress from '../layouts/Progress';
import AvatarGroup from '../layouts/AvatarGroup';
import { LuPaperclip, LuMessageSquare, LuTriangleAlert, LuCalendar } from 'react-icons/lu';
import { categoryColor, statusChip, priorityChip, statusFill } from '../../utils/data';
import { tilt } from '../../utils/tilt';

// The card shows the due date only. Start date was on the old card, but on a
// board you are scanning for what is late, not what began early - callers still
// pass createdAt and the detail view still carries it.
const TaskCard = ({
    title, description, priority,
    status, category, progress,
    dueDate, assignedTo, attachmentCount, commentCount,
    completedTodoCount, todoChecklist, onClick
}) => {
    const formattedDueDate = dueDate ? moment(dueDate).format("D MMM YYYY") : 'No due date';
    const totalTodoChecklistLength = todoChecklist?.length || 0;
    const isOverdue = status !== "Completed" && dueDate && moment(dueDate).isBefore(moment(), 'day');

    return (
        <article
            className="panel tilt relative overflow-hidden cursor-pointer text-left flex flex-col"
            onClick={onClick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
            role="button"
            tabIndex={0}
            {...tilt}
        >
            <span className="tilt-gloss" />

            {/* The status reads as a lit edge down the side of the pane, so a
                board can be scanned by colour without reading a single label. */}
            <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${statusFill(status)} opacity-80`} />

            <div className="relative p-5 flex flex-col gap-4 grow tilt-layer">
                <div className="flex flex-wrap items-center gap-2">
                    <span className={`chip ${statusChip(status)}`}>{status}</span>
                    <span className={`chip ${priorityChip(priority)}`}>{priority}</span>
                    {category && (
                        <span className={`chip border ${categoryColor(category)}`}>{category}</span>
                    )}
                </div>

                <div>
                    <h3 className="font-display text-lg text-beam leading-snug line-clamp-2">{title}</h3>
                    {description && (
                        <p className="text-sm text-mist mt-1.5 line-clamp-2 leading-relaxed">{description}</p>
                    )}
                </div>

                <div className="mt-auto">
                    <div className="flex items-baseline justify-between text-xs mb-2">
                        <span className="text-dusk">
                            <span className="text-beam font-medium num">{completedTodoCount}</span>
                            <span className="text-dusk"> / {totalTodoChecklistLength} done</span>
                        </span>
                        <span className="text-mist num">{progress ?? 0}%</span>
                    </div>
                    <Progress progress={progress} status={status} />
                </div>

                <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/8">
                    <div className={`flex items-center gap-1.5 text-xs ${isOverdue ? 'text-alert' : 'text-dusk'}`}>
                        {isOverdue ? <LuTriangleAlert className="shrink-0" /> : <LuCalendar className="shrink-0" />}
                        <span className="num">{formattedDueDate}</span>
                    </div>

                    <div className="flex items-center gap-3">
                        {commentCount > 0 && (
                            <span className="flex items-center gap-1 text-xs text-dusk">
                                <LuMessageSquare /> <span className="num">{commentCount}</span>
                            </span>
                        )}
                        {attachmentCount > 0 && (
                            <span className="flex items-center gap-1 text-xs text-dusk">
                                <LuPaperclip /> <span className="num">{attachmentCount}</span>
                            </span>
                        )}
                        <AvatarGroup avatars={assignedTo || []} />
                    </div>
                </div>
            </div>
        </article>
    );
};

export default TaskCard;
