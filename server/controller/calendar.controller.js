const Task = require('../model/task.model.js');
const Project = require('../model/project.model.js');
const { scopeFor } = require('../utils/scope.js');
const { projectScopeFor } = require('../utils/projectScope.js');
const { occurrencesBetween } = require('../utils/recurrence.js');
const { OPEN } = require('../utils/taskStatus.js');

const MAX_RANGE_DAYS = 62; // a month grid is 42 days; leave room, refuse "give me everything"
const DAY = 24 * 60 * 60 * 1000;

/**
 * GET /api/calendar?start=&end= (ISO dates)
 *   tasks     - scoped tasks due in the range
 *   projects  - visible projects whose deadline falls in the range
 *   recurring - FUTURE occurrences of open recurring tasks. They do not exist as rows yet
 *               (the next copy is only created when the current one completes), so they are
 *               projected from the task's rule and flagged as such.
 */
const getCalendar = async (req, res) => {
    try {
        const start = new Date(req.query.start);
        const end = new Date(req.query.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
            return res.status(400).json({ message: "start and end must be valid dates, start first" });
        }
        if ((end - start) / DAY > MAX_RANGE_DAYS) {
            return res.status(400).json({ message: `Ask for at most ${MAX_RANGE_DAYS} days at a time` });
        }

        const scope = await scopeFor(req.user);
        const projectScope = projectScopeFor(req.user);

        const [tasks, projects, recurring] = await Promise.all([
            Task.find({ ...scope, dueDate: { $gte: start, $lte: end } })
                .sort({ dueDate: 1, _id: 1 }).limit(1000)
                .select("title status priority category dueDate progress recurrence project").lean(),
            Project.find({ ...projectScope, dueDate: { $gte: start, $lte: end }, status: { $ne: "Cancelled" } })
                .sort({ dueDate: 1 }).limit(200).select("name status dueDate").lean(),
            Task.find({ ...scope, status: OPEN, recurrence: { $ne: "none" }, dueDate: { $ne: null, $lte: end } })
                .limit(300).select("title priority category dueDate recurrence").lean(),
        ]);

        const projected = recurring.flatMap((task) =>
            occurrencesBetween(task.dueDate, task.recurrence, start, end).map((dueDate) => ({
                taskId: task._id, title: task.title, priority: task.priority, category: task.category,
                recurrence: task.recurrence, dueDate,
            })));

        res.json({ tasks, projects, recurring: projected });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

module.exports = { getCalendar };
