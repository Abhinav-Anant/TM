export const colors = {
    bg: '#F6F7FB',
    card: '#FFFFFF',
    border: '#E6E8EF',
    text: '#111827',
    muted: '#6B7280',
    primary: '#2563EB',
    danger: '#E11D48',
};

export const STATUS_COLOR = {
    Pending: '#8D51FF',
    'In Progress': '#00B8DB',
    'In Review': '#FFB020',
    Completed: '#65A30D',
};

export const PRIORITY_COLOR = {
    High: '#E11D48',
    Medium: '#F59E0B',
    Low: '#10B981',
};

export const formatDate = (value) =>
    value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';

export const isOverdue = (task) =>
    task?.status !== 'Completed' && task?.dueDate && new Date(task.dueDate) < new Date(new Date().toDateString());
