/**
 * The background-job queue and the shared lock, against a real (in-memory) MongoDB.
 * The point of this file is "several app instances share one database": every race here is two
 * callers hitting the same collection at once, which is exactly what a second server does.
 * Run with: node server/test.jobs.js   (also part of `npm test`)
 */
const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

(async () => {
    const mongo = await MongoMemoryServer.create();
    process.env.JOB_POLL_MS = "50";
    await mongoose.connect(mongo.getUri("jobs_test"));

    const Job = require("./model/job.model.js");
    const jobs = require("./utils/jobs.js");
    const { registerJob, enqueue, tick, acquireLock, MAX_ATTEMPTS, _claimNext } = jobs;

    try {
        // --- a job runs once, then disappears -------------------------------------------
        const ran = [];
        registerJob("ok", async (payload) => { ran.push(payload.n); });
        await enqueue("ok", { n: 1 });
        await enqueue("ok", { n: 2 });
        assert.strictEqual(await tick(), 2, "tick drains everything due");
        assert.deepStrictEqual(ran.sort(), [1, 2]);
        assert.strictEqual(await Job.countDocuments(), 0, "finished jobs are removed");

        // --- jobs scheduled for later wait their turn -------------------------------------
        await enqueue("ok", { n: 3 }, { runAt: new Date(Date.now() + 60000) });
        assert.strictEqual(await tick(), 0, "a future job is not run early");
        await Job.deleteMany({});

        // --- two instances claiming at once never share a job -----------------------------
        await Job.insertMany(Array.from({ length: 25 }, (_, i) => ({ type: "ok", payload: { n: i } })));
        const claims = await Promise.all(Array.from({ length: 60 }, () => _claimNext()));
        const claimed = claims.filter(Boolean).map((j) => String(j._id));
        assert.strictEqual(claimed.length, 25, "every job is claimed");
        assert.strictEqual(new Set(claimed).size, 25, "...by exactly one claimer");
        assert.strictEqual(await _claimNext(), null, "nothing left while those locks hold");
        await Job.updateMany({}, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
        assert.ok(await _claimNext(), "a crashed worker's lock expires and the job is claimable again");
        await Job.deleteMany({});

        // --- failure: retried with backoff, then parked as failed ---------------------------
        let tries = 0;
        registerJob("flaky", async () => { tries += 1; throw new Error("gateway down"); });
        await enqueue("flaky", {});
        const sink = console.error; console.error = () => {};
        for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
            await tick();
            const job = await Job.findOne();
            if (i < MAX_ATTEMPTS) {
                assert.strictEqual(job.status, "pending");
                assert.ok(job.runAt.getTime() > Date.now() + 20000, `attempt ${i}: pushed back by the backoff`);
                await Job.updateOne({ _id: job._id }, { $set: { runAt: new Date() } }); // pretend the wait is over
            }
        }
        console.error = sink;
        const failed = await Job.findOne();
        assert.strictEqual(tries, MAX_ATTEMPTS, "tried exactly MAX_ATTEMPTS times");
        assert.strictEqual(failed.status, "failed", "then parked, not retried forever");
        assert.strictEqual(failed.lastError, "gateway down");
        assert.ok(failed.expireAt, "and scheduled for cleanup");
        assert.strictEqual(await tick(), 0, "failed jobs are never picked up again");
        await Job.deleteMany({});

        // --- a handler can defer without burning an attempt ----------------------------------
        let first = true;
        registerJob("slot", async () => {
            if (first) { first = false; return { retryAt: new Date(Date.now() + 40) }; }
            return undefined;
        });
        await enqueue("slot", {});
        await tick();
        const deferred = await Job.findOne();
        assert.strictEqual(deferred.attempts, 0, "deferring does not count as an attempt");
        await new Promise((r) => setTimeout(r, 60));
        await tick();
        assert.strictEqual(await Job.countDocuments(), 0, "and it completes once its slot opens");

        // --- an unknown job type fails loudly, it does not vanish -----------------------------
        await enqueue("nobody-handles-this", {});
        console.error = () => {};
        await tick();
        console.error = sink;
        assert.match((await Job.findOne()).lastError, /no handler/);
        await Job.deleteMany({});

        // --- the lock: one winner among many, then it frees up ---------------------------------
        const grabs = await Promise.all(Array.from({ length: 30 }, () => acquireLock("scan-test", 200)));
        assert.strictEqual(grabs.filter((g) => g.ok).length, 1, "exactly one of 30 simultaneous callers gets the lock");
        const loser = grabs.find((g) => !g.ok);
        assert.ok(loser.until > new Date(), "losers are told when it frees up");
        assert.strictEqual((await acquireLock("scan-test", 200)).ok, false, "still held");
        assert.strictEqual((await acquireLock("another-name", 200)).ok, true, "locks are independent by name");
        await new Promise((r) => setTimeout(r, 250));
        assert.strictEqual((await acquireLock("scan-test", 200)).ok, true, "free again after it expires");

        console.log("Job queue + lock checks passed.");
    } catch (error) {
        console.error("\nFAILED:", error.message);
        console.error(error.stack.split("\n").slice(1, 4).join("\n"));
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
        await mongo.stop();
    }
})();
