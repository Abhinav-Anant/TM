import React from 'react';
import moment from 'moment';
import { statusChip, priorityChip } from '../utils/data';

const TaskListTable = ({ tableData = [] }) => {
    if (tableData.length === 0) {
        return <p className="text-sm text-dusk py-8">No tasks yet. Create one to get started.</p>;
    }

    return (
        <div className="overflow-x-auto -mx-1 px-1">
            <table className="min-w-full border-separate border-spacing-y-1.5">
                <thead>
                    <tr className="text-left">
                        <th className="py-2 px-3 text-xs font-medium text-dusk">Task</th>
                        <th className="py-2 px-3 text-xs font-medium text-dusk">Status</th>
                        <th className="py-2 px-3 text-xs font-medium text-dusk">Priority</th>
                        <th className="py-2 px-3 text-xs font-medium text-dusk hidden md:table-cell">Created</th>
                    </tr>
                </thead>
                <tbody>
                    {tableData.map((task) => (
                        <tr key={task._id} className="group">
                            <td className="py-2.5 px-3 text-sm text-beam rounded-l-lg bg-white/[0.03] group-hover:bg-white/[0.07] transition-colors">
                                <span className="line-clamp-1">{task.title}</span>
                            </td>
                            <td className="py-2.5 px-3 bg-white/[0.03] group-hover:bg-white/[0.07] transition-colors">
                                <span className={`chip ${statusChip(task.status)}`}>{task.status}</span>
                            </td>
                            <td className="py-2.5 px-3 bg-white/[0.03] group-hover:bg-white/[0.07] transition-colors md:rounded-none rounded-r-lg">
                                <span className={`chip ${priorityChip(task.priority)}`}>{task.priority}</span>
                            </td>
                            <td className="py-2.5 px-3 text-sm text-dusk whitespace-nowrap hidden md:table-cell rounded-r-lg bg-white/[0.03] group-hover:bg-white/[0.07] transition-colors num">
                                {task.createdAt ? moment(task.createdAt).format('D MMM YYYY') : '--'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default TaskListTable;
