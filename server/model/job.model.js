const mongoose = require('mongoose');

// A unit of background work (send a WhatsApp, an email, a push). Stored in MongoDB so any
// number of app instances share one queue: a worker claims a job with a conditional update,
// so each job runs on exactly one of them. See utils/jobs.js.
const jobSchema = new mongoose.Schema({
    type: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    runAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    // While set and in the future, some worker owns the job. A crashed worker's lock simply expires.
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: "" },
    // Failed jobs are kept for a week for inspection, then Mongo deletes them.
    expireAt: { type: Date, default: null },
},
{
    timestamps: true
});

jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Job", jobSchema);
