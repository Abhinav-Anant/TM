// One definition of the task lifecycle, shared by the model, controllers and reminders.
const STATUSES = ['To Do', 'In Progress', 'Blocked', 'In Review', 'Completed', 'Cancelled'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
// Finished with, one way or the other: never overdue, never "open".
const CLOSED = ['Completed', 'Cancelled'];
const OPEN = { $nin: CLOSED };

const PRIORITY_ORDER = { Urgent: 4, High: 3, Medium: 2, Low: 1 };

module.exports = { STATUSES, PRIORITIES, CLOSED, OPEN, PRIORITY_ORDER };
