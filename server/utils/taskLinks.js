const Task = require('../model/task.model.js');
const { OPEN } = require('./taskStatus.js');

const MAX_TAGS = 10;

/** "#Website", " website " -> "website"; blanks and repeats dropped, capped at MAX_TAGS. */
const normalizeTags = (tags) => [...new Set(
    (Array.isArray(tags) ? tags : [])
        .map((t) => String(t).trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').slice(0, 30))
        .filter(Boolean)
)].slice(0, MAX_TAGS);

/** Unfinished tasks this one is waiting on: [{_id, title}]. */
const openBlockers = (task) => (task.blockedBy?.length
    ? Task.find({ _id: { $in: task.blockedBy }, status: OPEN }).select('title').lean()
    : Promise.resolve([]));

/** Map of taskId -> titles it is waiting on, for a whole page of tasks in one query (no N+1). */
const waitingForByTask = async (tasks) => {
    const ids = [...new Set(tasks.flatMap((t) => (t.blockedBy || []).map(String)))];
    if (!ids.length) return new Map();
    const open = new Map((await Task.find({ _id: { $in: ids }, status: OPEN }).select('title').lean())
        .map((t) => [String(t._id), t.title]));
    return new Map(tasks.map((t) => [
        String(t._id),
        (t.blockedBy || []).map(String).filter((id) => open.has(id)).map((id) => open.get(id)),
    ]));
};

/** Would making `taskId` wait on `blockerIds` create a loop (A waits on B waits on A)? */
const createsCycle = async (taskId, blockerIds) => {
    const target = String(taskId);
    const seen = new Set();
    let frontier = blockerIds.map(String);
    while (frontier.length) {
        if (frontier.includes(target)) return true;
        frontier.forEach((id) => seen.add(id));
        const docs = await Task.find({ _id: { $in: frontier } }).select('blockedBy').lean();
        frontier = [...new Set(docs.flatMap((d) => (d.blockedBy || []).map(String)))].filter((id) => !seen.has(id));
    }
    return false;
};

module.exports = { normalizeTags, openBlockers, waitingForByTask, createsCycle, MAX_TAGS };
