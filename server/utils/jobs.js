/**
 * A small database-backed job queue and lock, safe with any number of app instances.
 * Redis/BullMQ would do the same job; MongoDB is already here, and this is the same shape
 * (enqueue / handler / retry with backoff), so swapping it later touches only this file.
 *
 *   registerJob("email", async (payload, job) => { ... })   // throw to retry, return { retryAt } to defer
 *   await enqueue("email", { to, subject, text })
 *   startWorker()                                           // once per process
 */
const mongoose = require('mongoose');
const Job = require('../model/job.model.js');

const POLL_MS = Number(process.env.JOB_POLL_MS) || 1000;
const LOCK_MS = 60 * 1000;            // a worker that dies mid-job frees it after this
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 30 * 1000;          // 30s, 2m, 8m, 32m, 2h
const FAILED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const handlers = new Map();
const registerJob = (type, handler) => handlers.set(type, handler);

let timer = null;
let busy = false;

const enqueue = async (type, payload = {}, { runAt = new Date() } = {}) => {
    const job = await Job.create({ type, payload, runAt });
    // Don't wait for the next poll: this process can start on it right away.
    if (timer) setImmediate(() => tick().catch(() => {}));
    return job;
};

const claimNext = (now = new Date()) => Job.findOneAndUpdate(
    { status: 'pending', runAt: { $lte: now }, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
    { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, new: true },
);

/** Runs one claimed job and records the outcome. Never throws. */
const runJob = async (job) => {
    const handler = handlers.get(job.type);
    try {
        if (!handler) throw new Error(`no handler for job type "${job.type}"`);
        const result = await handler(job.payload, job);
        if (result && result.retryAt) {
            // Deferred, not failed (e.g. waiting for a rate-limit slot): doesn't use up an attempt.
            await Job.updateOne({ _id: job._id }, { $set: { runAt: result.retryAt, lockedUntil: null }, $inc: { attempts: -1 } });
        } else {
            await Job.deleteOne({ _id: job._id });
        }
    } catch (error) {
        const exhausted = job.attempts >= MAX_ATTEMPTS;
        await Job.updateOne({ _id: job._id }, exhausted
            ? { $set: { status: 'failed', lastError: error.message, lockedUntil: null, expireAt: new Date(Date.now() + FAILED_KEEP_MS) } }
            : { $set: { lastError: error.message, lockedUntil: null, runAt: new Date(Date.now() + BACKOFF_MS * 4 ** (job.attempts - 1)) } });
        console.error(`Job ${job.type} failed (attempt ${job.attempts}/${MAX_ATTEMPTS}):`, error.message);
    }
};

/** Drains everything currently due. Re-entrancy guarded so a slow job cannot stack ticks. */
const tick = async () => {
    if (busy) return 0;
    busy = true;
    let ran = 0;
    try {
        for (let job = await claimNext(); job; job = await claimNext()) {
            await runJob(job);
            ran += 1;
        }
    } finally {
        busy = false;
    }
    return ran;
};

const startWorker = () => {
    if (timer) return timer;
    timer = setInterval(() => tick().catch((e) => console.error("Job tick failed:", e.message)), POLL_MS);
    timer.unref?.();
    return timer;
};

const stopWorker = () => { clearInterval(timer); timer = null; };

// ---- named lock (leader election for scheduled scans, rate-limit slots) --------------
const lockSchema = new mongoose.Schema({ _id: String, until: Date });
const Lock = mongoose.models.Lock || mongoose.model("Lock", lockSchema);

/**
 * Takes the named lock for `ms` if nobody holds it. Returns { ok, until }; `until` is when the
 * current holder's claim ends, so a caller that lost can reschedule itself for then.
 * Atomic: the conditional update and the insert-if-absent cannot both succeed for two callers.
 */
const acquireLock = async (name, ms) => {
    const now = new Date();
    const until = new Date(now.getTime() + ms);
    const taken = await Lock.findOneAndUpdate({ _id: name, until: { $lte: now } }, { $set: { until } }, { new: true });
    if (taken) return { ok: true, until };
    try {
        await Lock.create({ _id: name, until });
        return { ok: true, until };
    } catch (error) {
        if (error.code !== 11000) throw error;
        const current = await Lock.findById(name).lean();
        return { ok: false, until: current?.until || until };
    }
};

module.exports = { registerJob, enqueue, startWorker, stopWorker, tick, acquireLock, MAX_ATTEMPTS, _claimNext: claimNext };
