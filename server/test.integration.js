/**
 * End-to-end check of every feature added to this project.
 * Boots a real MongoDB (in-memory), a fake WhatsApp gateway and the real `server/index.js`
 * process, then drives the HTTP API exactly as the clients do.
 *
 * Run with: npm run test:e2e
 */
const assert = require("assert");
const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { MongoMemoryServer } = require("mongodb-memory-server");

const PORT = 4321;
const BLASTUP_PORT = 4325;
const BLASTUP_KEY = "e2e-gateway-key";
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_TOKEN = "let-me-in";
const HEAD_TOKEN = "lead-me-in";
const UPLOAD_DIR = path.join(__dirname, "uploads");

const results = [];
const pass = (feature, detail) => { results.push({ ok: true, feature, detail }); };

const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
};

const hours = (offset) => new Date(Date.now() + offset * 60 * 60 * 1000).toISOString();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- fake Blastup gateway, so we can prove a WhatsApp message actually leaves ---
// Speaks just enough of the real contract: POST /api/send/text, x-api-key header,
// {to, text} body. Rejecting a wrong key here is what proves the app sends one.
const startWhatsAppGateway = () => {
    const received = [];
    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
            if (req.method !== "POST" || req.url !== "/api/send/text") {
                res.writeHead(404).end('{"error":"not found"}');
                return;
            }
            if (req.headers["x-api-key"] !== BLASTUP_KEY) {
                res.writeHead(401).end('{"error":"bad api key"}');
                return;
            }
            try {
                received.push(JSON.parse(body));
            } catch {
                res.writeHead(400).end('{"error":"bad json"}');
                return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"success":true}');
        });
    });

    return new Promise((resolve) => {
        server.listen(BLASTUP_PORT, "127.0.0.1", () => resolve({ server, received }));
    });
};

// --- http helpers -------------------------------------------------------------
const call = async (method, url, { token, body, raw } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body && !raw) headers["Content-Type"] = "application/json";
    if (raw) Object.assign(headers, raw.headers);

    const response = await fetch(`${BASE}${url}`, {
        method,
        headers,
        body: raw ? raw.body : (body ? JSON.stringify(body) : undefined),
    });

    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html or binary */ }
    return { status: response.status, body: json, text };
};

/** Opens the SSE stream and collects every pushed event. */
const openStream = (token) => new Promise((resolve, reject) => {
    const req = http.request(
        { host: "127.0.0.1", port: PORT, path: "/api/notifications/stream", headers: { Authorization: `Bearer ${token}` } },
        (res) => {
            if (res.statusCode !== 200) return reject(new Error(`stream status ${res.statusCode}`));
            const events = [];
            let buffer = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
                buffer += chunk;
                let i = buffer.indexOf("\n\n");
                while (i !== -1) {
                    const line = buffer.slice(0, i).split("\n").find((l) => l.startsWith("data:"));
                    buffer = buffer.slice(i + 2);
                    if (line) { try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* ignore */ } }
                    i = buffer.indexOf("\n\n");
                }
            });
            resolve({ events, contentType: res.headers["content-type"], close: () => req.destroy() });
        }
    );
    req.on("error", reject);
    req.end();
});

const uploadFiles = async (token, files) => {
    const boundary = `----tmtest${Date.now()}`;
    const parts = [];
    for (const f of files) {
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\n` +
            `Content-Type: ${f.type}\r\n\r\n`
        ));
        parts.push(Buffer.from(f.content));
        parts.push(Buffer.from("\r\n"));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const payload = Buffer.concat(parts);

    return call("POST", "/api/tasks/upload", {
        token,
        raw: { headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body: payload },
    });
};

const uploadCsv = async (token, content, name = "members.csv") => {
    const boundary = `----tmcsv${Date.now()}`;
    const payload = Buffer.concat([
        Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
            `Content-Type: text/csv\r\n\r\n`
        ),
        Buffer.from(content),
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    return call("POST", "/api/users/import", {
        token,
        raw: { headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body: payload },
    });
};

const waitForServer = async () => {
    for (let i = 0; i < 120; i += 1) {
        try {
            const res = await fetch(`${BASE}/api/tasks`);
            if (res.status === 401) return;
        } catch { /* not up yet */ }
        await sleep(500);
    }
    throw new Error("Server never became ready");
};

// --- the run -----------------------------------------------------------------
(async () => {
    const mongo = await MongoMemoryServer.create();
    const wa = await startWhatsAppGateway();
    const before = new Set(fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR) : []);

    const server = spawn(process.execPath, [path.join(__dirname, "index.js")], {
        cwd: path.join(__dirname, ".."),
        env: {
            ...process.env,
            PORT: String(PORT),
            MONGO_URI: mongo.getUri("taskmanager_e2e"),
            JWT_SECRET: "e2e-secret",
            ADMIN_INVITE_TOKEN: ADMIN_TOKEN,
            HEAD_INVITE_TOKEN: HEAD_TOKEN,
            CLIENT_URL: "http://localhost:5173",
            BLASTUP_URL: `http://127.0.0.1:${BLASTUP_PORT}`,
            BLASTUP_API_KEY: BLASTUP_KEY,
            DEFAULT_COUNTRY_CODE: "91",
            WHATSAPP_SEND_GAP_MS: "0", // pacing is a gateway concern; keep the suite quick
            REMINDER_WINDOW_HOURS: "24",
            REMINDER_INTERVAL_MINUTES: "0.05", // 3s, so the scan is observable
            NODE_ENV: "test",
        },
        stdio: ["ignore", "pipe", "pipe"],
    });

    const serverLog = [];
    server.stdout.on("data", (d) => serverLog.push(d.toString()));
    server.stderr.on("data", (d) => serverLog.push(d.toString()));

    const cleanup = async () => {
        server.kill();
        wa.server.close();
        await mongo.stop();
        // remove only what this run uploaded
        if (fs.existsSync(UPLOAD_DIR)) {
            fs.readdirSync(UPLOAD_DIR)
                .filter((f) => !before.has(f))
                .forEach((f) => fs.unlinkSync(path.join(UPLOAD_DIR, f)));
        }
    };

    try {
        await waitForServer();

        // ---------- accounts ----------
        const admin = (await call("POST", "/api/auth/register", {
            body: { name: "Ada Admin", email: "admin@example.test", password: "pw123456", adminInviteToken: ADMIN_TOKEN },
        })).body;
        const member = (await call("POST", "/api/auth/register", {
            // spaces on purpose: the server must normalise this to 919876543210
            body: { name: "Mo Member", email: "member@example.test", password: "pw123456", phone: "98765 43210" },
        })).body;
        const outsider = (await call("POST", "/api/auth/register", {
            body: { name: "Otto Outsider", email: "outsider@example.test", password: "pw123456" },
        })).body;

        assert.strictEqual(admin.role, "admin", "admin invite token should grant admin");
        assert.strictEqual(member.role, "member");
        const A = admin.token, M = member.token, O = outsider.token;

        // ---------- 8. TASK CATEGORIES ----------
        const mk = async (over) => {
            const res = await call("POST", "/api/tasks", {
                token: A,
                body: {
                    title: "Task", description: "d", priority: "Medium", category: "General",
                    dueDate: day(3), assignedTo: [member._id],
                    todoChecklist: [{ text: "step one", completed: false }, { text: "step two", completed: false }],
                    ...over,
                },
            });
            assert.strictEqual(res.status, 201, `create failed: ${res.text}`);
            return res.body.task;
        };

        const design = await mk({ title: "Design the landing page", description: "hero and footer", category: "Design", priority: "High", dueDate: day(2) });
        const devTask = await mk({ title: "Build the API layer", description: "express routes", category: "Development", priority: "Low", dueDate: day(9) });
        const research = await mk({ title: "Research competitors", description: "a.b literal probe", category: "Research", priority: "Medium", dueDate: day(20) });
        const overdue = await mk({ title: "Ship the old invoice", description: "late", category: "Operations", priority: "High", dueDate: day(-4) });

        const cats = await call("GET", "/api/tasks/categories", { token: A });
        assert.deepStrictEqual(cats.body.categories, ["Design", "Development", "Operations", "Research"]);
        pass("Task Categories", `stored on tasks; /categories returned ${cats.body.categories.join(", ")}`);

        // ---------- 3. SEARCH ----------
        const byTitle = await call("GET", "/api/tasks?search=landing", { token: A });
        assert.strictEqual(byTitle.body.tasks.length, 1);
        assert.strictEqual(byTitle.body.tasks[0]._id, design._id);

        const byDesc = await call("GET", "/api/tasks?search=express%20routes", { token: A });
        assert.strictEqual(byDesc.body.tasks.length, 1, "search must cover description");
        assert.strictEqual(byDesc.body.tasks[0]._id, devTask._id);

        const caseInsensitive = await call("GET", "/api/tasks?search=LANDING", { token: A });
        assert.strictEqual(caseInsensitive.body.tasks.length, 1, "search must be case-insensitive");

        // regex metacharacters must stay literal
        const dotProbe = await call("GET", "/api/tasks?search=a.b", { token: A });
        assert.strictEqual(dotProbe.body.tasks.length, 1, "'a.b' should match only the literal text");
        assert.strictEqual(dotProbe.body.tasks[0]._id, research._id);
        const wildcardProbe = await call("GET", "/api/tasks?search=a%2Bb", { token: A }); // "a+b"
        assert.strictEqual(wildcardProbe.status, 200, "regex metacharacters must not crash the query");
        assert.strictEqual(wildcardProbe.body.tasks.length, 0);
        pass("Search Functionality", "title + description, case-insensitive, regex metacharacters escaped");

        // ---------- 2. ADVANCED FILTERING ----------
        const high = await call("GET", "/api/tasks?priority=High", { token: A });
        assert.strictEqual(high.body.tasks.length, 2);
        assert.ok(high.body.tasks.every((t) => t.priority === "High"));

        const byCategory = await call("GET", "/api/tasks?category=Development", { token: A });
        assert.strictEqual(byCategory.body.tasks.length, 1);

        const range = await call("GET", `/api/tasks?dueAfter=${day(1).slice(0, 10)}&dueBefore=${day(10).slice(0, 10)}`, { token: A });
        assert.deepStrictEqual(
            range.body.tasks.map((t) => t._id).sort(),
            [design._id, devTask._id].sort(),
            "deadline range filter"
        );

        const overdueOnly = await call("GET", "/api/tasks?overdue=true", { token: A });
        assert.strictEqual(overdueOnly.body.tasks.length, 1);
        assert.strictEqual(overdueOnly.body.tasks[0]._id, overdue._id);

        const byStatus = await call("GET", "/api/tasks?status=Pending", { token: A });
        assert.strictEqual(byStatus.body.tasks.length, 4);
        assert.strictEqual(byStatus.body.statusSummary.all, 4, "tab counts come back with the list");

        const sorted = await call("GET", "/api/tasks?sortBy=dueDate&sortOrder=asc", { token: A });
        const dues = sorted.body.tasks.map((t) => new Date(t.dueDate).getTime());
        assert.deepStrictEqual(dues, [...dues].sort((a, b) => a - b), "sortBy=dueDate asc");

        const byPriority = await call("GET", "/api/tasks?sortBy=priority&sortOrder=desc", { token: A });
        assert.strictEqual(byPriority.body.tasks[0].priority, "High", "priority sorts High first, not alphabetically");

        const injection = await call("GET", "/api/tasks?sortBy=$where", { token: A });
        assert.strictEqual(injection.status, 200, "non-whitelisted sort field falls back safely");

        const combined = await call("GET", "/api/tasks?priority=High&category=Design&search=landing", { token: A });
        assert.strictEqual(combined.body.tasks.length, 1, "filters combine");
        pass("Advanced Filtering", "priority, category, deadline range, overdue, status, sort whitelist, combined");

        // scoping still holds
        const outsiderView = await call("GET", "/api/tasks", { token: O });
        assert.strictEqual(outsiderView.body.tasks.length, 0, "members only see tasks assigned to them");
        const memberView = await call("GET", "/api/tasks", { token: M });
        assert.strictEqual(memberView.body.tasks.length, 4);

        // ---------- 1. REAL-TIME NOTIFICATIONS (SSE) ----------
        const stream = await openStream(M);
        assert.ok(/text\/event-stream/.test(stream.contentType), "SSE content type");
        await sleep(300);

        const liveTask = await mk({ title: "Live push probe", category: "Design", dueDate: day(5) });
        await sleep(1200);

        const pushed = stream.events.filter((e) => e.type !== "ping" && e.type !== "connected");
        assert.ok(pushed.length >= 1, `expected a pushed notification, got ${JSON.stringify(stream.events)}`);
        assert.ok(
            pushed.some((e) => e.title.includes("Live push probe")),
            "the assignment alert should arrive over the open stream"
        );
        pass("Notifications (real-time)", `SSE frame delivered for "${pushed[0].title}"`);

        // comment + status pushes travel the same channel
        await call("POST", `/api/tasks/${design._id}/comments`, { token: A, body: { text: "looks good, ship it" } });
        await sleep(800);
        assert.ok(
            stream.events.some((e) => e.type === "comment"),
            "comment notification pushed live"
        );

        // Every frame carries the server's own unread count. A client that increments
        // locally instead drifts, so the count must be on the wire and must agree with
        // the list endpoint after several pushes.
        const counted = stream.events.filter((e) => e.type !== "ping" && e.type !== "connected");
        assert.ok(
            counted.every((e) => typeof e.unreadCount === "number"),
            `every pushed frame must carry unreadCount, got ${JSON.stringify(counted)}`
        );
        const streamCounts = counted.map((e) => e.unreadCount);
        assert.deepStrictEqual(
            streamCounts,
            [...streamCounts].sort((a, b) => a - b),
            "unreadCount must not go backwards across consecutive pushes"
        );

        const liveList = await call("GET", "/api/notifications", { token: M });
        assert.strictEqual(
            streamCounts[streamCounts.length - 1],
            liveList.body.unreadCount,
            "the last frame's unreadCount must match GET /api/notifications - no drift"
        );

        // Deleting an unread notification changes the count, so the delete response
        // reports it too - otherwise the badge stays high until a refetch.
        const doomed = liveList.body.notifications.find((n) => !n.read);
        const removed = await call("DELETE", `/api/notifications/${doomed._id}`, { token: M });
        assert.strictEqual(removed.status, 200);
        assert.strictEqual(
            removed.body.unreadCount,
            liveList.body.unreadCount - 1,
            "deleting an unread notification must return the decremented count"
        );
        pass("Notifications (unread count)", `server-authoritative across ${streamCounts.length} pushes + delete`);

        // ---------- 4. TASK COMMENTS ----------
        const posted = await call("POST", `/api/tasks/${devTask._id}/comments`, { token: M, body: { text: "starting on this now" } });
        assert.strictEqual(posted.status, 201);
        assert.strictEqual(posted.body.comments.length, 1);
        assert.strictEqual(posted.body.comments[0].text, "starting on this now");
        assert.strictEqual(posted.body.comments[0].user.name, "Mo Member", "comment author is populated");

        const empty = await call("POST", `/api/tasks/${devTask._id}/comments`, { token: M, body: { text: "   " } });
        assert.strictEqual(empty.status, 400, "blank comments rejected");

        const notAllowed = await call("POST", `/api/tasks/${devTask._id}/comments`, { token: O, body: { text: "sneaking in" } });
        assert.strictEqual(notAllowed.status, 403, "non-assignee cannot comment");

        const fetched = await call("GET", `/api/tasks/${devTask._id}`, { token: M });
        assert.strictEqual(fetched.body.comments.length, 1, "comments persist on the task");

        const commentId = posted.body.comments[0]._id;
        const strangerDelete = await call("DELETE", `/api/tasks/${devTask._id}/comments/${commentId}`, { token: O });
        assert.strictEqual(strangerDelete.status, 403, "only author or admin may delete");
        const authorDelete = await call("DELETE", `/api/tasks/${devTask._id}/comments/${commentId}`, { token: M });
        assert.strictEqual(authorDelete.status, 200);
        assert.strictEqual(authorDelete.body.comments.length, 0);
        pass("Task Comments", "post, populate author, reject blank + outsider, author/admin delete");

        // ---------- 5. FILE ATTACHMENTS ----------
        const upload = await uploadFiles(M, [
            { name: "spec notes.txt", type: "text/plain", content: "acceptance criteria" },
            { name: "budget.csv", type: "text/csv", content: "item,cost\nhosting,20" },
        ]);
        assert.strictEqual(upload.status, 200, `upload failed: ${upload.text}`);
        assert.strictEqual(upload.body.urls.length, 2);

        // the returned URL must actually serve the file back
        const servedPath = new URL(upload.body.urls[0]).pathname;
        const served = await call("GET", servedPath);
        assert.strictEqual(served.status, 200, "uploaded file must be served from /uploads");
        assert.strictEqual(served.text, "acceptance criteria", "served bytes match what was uploaded");

        const rejected = await uploadFiles(M, [{ name: "payload.exe", type: "application/x-msdownload", content: "MZ" }]);
        assert.strictEqual(rejected.status, 400, "disallowed mime type rejected");

        const attached = await call("PUT", `/api/tasks/${design._id}`, { token: A, body: { attachments: upload.body.urls } });
        assert.strictEqual(attached.status, 200);
        assert.strictEqual(attached.body.updatedTask.attachments.length, 2, "attachments saved on the task");
        pass("File Attachments", "multipart upload, served back over /uploads, mime filter, saved on task");

        // ---------- 6. CALENDAR (the date-range query the month grid runs) ----------
        const weekStart = day(0).slice(0, 10);
        const weekEnd = day(7).slice(0, 10);
        const monthCells = await call("GET", `/api/tasks?dueAfter=${weekStart}&dueBefore=${weekEnd}&sortBy=dueDate&sortOrder=asc`, { token: M });
        assert.strictEqual(monthCells.status, 200);
        const ids = monthCells.body.tasks.map((t) => t._id);
        assert.ok(ids.includes(design._id) && ids.includes(liveTask._id), "in-range deadlines present");
        assert.ok(!ids.includes(research._id) && !ids.includes(overdue._id), "out-of-range deadlines excluded");
        assert.ok(monthCells.body.tasks.every((t) => t.dueDate), "every task carries the dueDate the grid buckets on");
        pass("Calendar Integration", `range query returned ${ids.length} tasks for the visible window only`);

        // ---------- 9. PROGRESS TRACKING ----------
        const half = await call("PUT", `/api/tasks/${devTask._id}/todo`, {
            token: M,
            body: { todoChecklist: [{ text: "step one", completed: true }, { text: "step two", completed: false }] },
        });
        assert.strictEqual(half.body.task.progress, 50, "progress recomputed from the checklist");
        assert.strictEqual(half.body.task.status, "In Progress", "status follows progress");
        assert.strictEqual(half.body.task.completedAt, null);

        const done = await call("PUT", `/api/tasks/${devTask._id}/todo`, {
            token: M,
            body: { todoChecklist: [{ text: "step one", completed: true }, { text: "step two", completed: true }] },
        });
        assert.strictEqual(done.body.task.progress, 100);
        assert.strictEqual(done.body.task.status, "Completed");
        assert.ok(done.body.task.completedAt, "completedAt stamped - this is what the trend chart reads");

        const analytics = await call("GET", "/api/tasks/analytics?days=30", { token: A });
        assert.strictEqual(analytics.status, 200);
        const { totals, byStatus: aStatus, byPriority: aPriority, byCategory: aCategory, trend, upcoming } = analytics.body;
        assert.strictEqual(totals.all, 5);
        assert.strictEqual(totals.completed, 1);
        assert.strictEqual(totals.completionRate, 20, "1 of 5 completed");
        assert.strictEqual(totals.overdue, 1);
        assert.ok(totals.avgProgress >= 0 && totals.avgProgress <= 100);
        assert.ok(aStatus.length > 0 && aPriority.length > 0);
        assert.strictEqual(aCategory.reduce((n, c) => n + c.count, 0), 5, "category breakdown covers every task");
        assert.strictEqual(trend.length, 30, "continuous 30-day axis");
        assert.strictEqual(trend[trend.length - 1].completed, 1, "today's completion lands on the trend");
        assert.ok(trend.every((p) => typeof p.created === "number"), "no gaps in the trend axis");
        assert.ok(upcoming.length > 0 && new Date(upcoming[0].dueDate) >= new Date(), "next deadlines are in the future");

        const memberAnalytics = await call("GET", "/api/tasks/analytics", { token: O });
        assert.strictEqual(memberAnalytics.body.totals.all, 0, "analytics are scoped per user");
        pass("Progress Tracking", `progress/status/completedAt recomputed; analytics totals=${totals.all} rate=${totals.completionRate}% trend=${trend.length}d`);

        // ---------- 1b. NOTIFICATION INBOX ----------
        const inbox = await call("GET", "/api/notifications", { token: M });
        assert.ok(inbox.body.notifications.length > 0);
        assert.ok(inbox.body.unreadCount > 0);
        assert.ok(inbox.body.notifications[0].task, "notifications link back to their task");

        const first = inbox.body.notifications[0];
        const read = await call("PUT", `/api/notifications/${first._id}/read`, { token: M });
        assert.strictEqual(read.status, 200);
        assert.strictEqual(read.body.unreadCount, inbox.body.unreadCount - 1);

        const foreign = await call("PUT", `/api/notifications/${first._id}/read`, { token: O });
        assert.strictEqual(foreign.status, 404, "you cannot touch another user's notifications");

        const allRead = await call("PUT", "/api/notifications/read-all", { token: M });
        assert.strictEqual(allRead.body.unreadCount, 0);
        pass("Notifications (inbox)", "list, unread count, mark one/all read, per-user isolation");

        // ---------- 7. DEADLINE ALERTS ----------
        // Something inside the 24h window, so the "due soon" branch has a subject.
        await mk({ title: "Submit the timesheet", category: "Operations", dueDate: hours(6) });

        let deadlineAlerts = [];
        for (let i = 0; i < 20; i += 1) {
            await sleep(1000);
            const notes = await call("GET", "/api/notifications?limit=100", { token: M });
            deadlineAlerts = notes.body.notifications.filter((n) => n.type === "overdue" || n.type === "deadline");
            if (deadlineAlerts.some((n) => n.type === "overdue") && deadlineAlerts.some((n) => n.type === "deadline")) break;
        }
        assert.ok(deadlineAlerts.some((n) => n.type === "overdue"), "overdue task must raise an alert");
        assert.ok(deadlineAlerts.some((n) => n.type === "deadline"), "task due within 24h must raise a reminder");

        // and the scan must not re-send on every pass
        const countA = deadlineAlerts.length;
        await sleep(4000);
        const later = await call("GET", "/api/notifications?limit=100", { token: M });
        const countB = later.body.notifications.filter((n) => n.type === "overdue" || n.type === "deadline").length;
        assert.strictEqual(countB, countA, "reminders must not repeat on every scan");
        pass("Deadline alerts", `${countA} reminder(s) raised by the scheduler, no duplicates after 2 more scans`);

        // ---------- 10. WHATSAPP NOTIFICATIONS ----------
        let sent = wa.received;
        for (let i = 0; i < 15 && sent.length === 0; i += 1) { await sleep(500); sent = wa.received; }
        assert.ok(sent.length > 0, "at least one WhatsApp message should have reached the gateway");

        // The gateway rejects a wrong key with a 401, so anything arriving here
        // proves the app authenticated - and the number proves normalisation ran
        // on the way in: the member registered with "98765 43210".
        assert.ok(sent.every((m) => m.to === "919876543210"),
            "every message is addressed to the assignee's normalised number");
        assert.ok(sent.some((m) => /localhost:5173\/user\/task-details\//.test(m.text)),
            "deep link back to the task");
        assert.ok(sent.some((m) => /Ada Admin assigned you/.test(m.text)),
            "the message names who acted");
        assert.ok(sent.every((m) => m.text.length <= 4096), "within the gateway's text limit");
        pass("WhatsApp Notifications", `${sent.length} message(s) delivered to the gateway, addressed + deep-linked`);

        // A member with no number on file must never reach the gateway - the
        // in-app alert still lands, which is the whole point of not hard-gating.
        const beforeSilent = wa.received.length;
        const silentTask = (await call("POST", "/api/tasks", {
            token: A, body: { title: "No number on file", dueDate: day(3), assignedTo: [outsider._id] },
        })).body.task;
        assert.ok(silentTask._id, "task for the number-less member was created");

        await sleep(2000);
        assert.ok(
            wa.received.slice(beforeSilent).every((m) => m.to === "919876543210"),
            "nothing was sent for the member who never saved a number"
        );
        const outsiderInbox = await call("GET", "/api/notifications?limit=100", { token: O });
        assert.ok(
            outsiderInbox.body.notifications.some((n) => /No number on file/.test(n.title)),
            "they still get the in-app notification"
        );
        pass("WhatsApp opt-in", "members without a saved number are skipped, in-app alert still delivered");

        // A number the server cannot normalise is refused rather than stored,
        // so nobody is left believing they are reachable when they are not.
        assert.strictEqual(
            (await call("PUT", "/api/auth/profile", { token: O, body: { phone: "12345" } })).status, 400,
            "a junk number is rejected"
        );
        const saved = await call("PUT", "/api/auth/profile", { token: O, body: { phone: "+91 91234 56789" } });
        assert.strictEqual(saved.status, 200);
        assert.strictEqual(saved.body.phone, "919123456789", "stored in the gateway's bare international form");
        pass("Phone number validation", "junk rejected with 400, valid input normalised to 919123456789");

        stream.close();

        // ---------- auth guards ----------
        assert.strictEqual((await call("GET", "/api/tasks")).status, 401);
        assert.strictEqual((await call("GET", "/api/notifications")).status, 401);
        assert.strictEqual((await call("GET", "/api/notifications/stream")).status, 401);
        assert.strictEqual((await call("POST", "/api/tasks", { token: M, body: { title: "x", assignedTo: [] } })).status, 403, "members cannot create tasks");
        assert.strictEqual((await call("GET", "/api/tasks/dashboard-data", { token: M })).status, 403);

        // A task id is guessable and the document carries descriptions, attachments
        // and comments - a member must not be able to read one they are not on.
        assert.strictEqual((await call("GET", `/api/tasks/${design._id}`, { token: O })).status, 403, "outsider cannot read a task by id");
        assert.strictEqual((await call("GET", `/api/tasks/${design._id}`, { token: M })).status, 200, "assignee can read it");
        assert.strictEqual((await call("GET", `/api/tasks/${design._id}`, { token: A })).status, 200, "admin can read any task");
        assert.strictEqual((await call("GET", "/api/nope")).status, 404);

        // A correctly signed token naming a user that no longer exists must be 401, not a 500.
        const ghost = require("jsonwebtoken").sign(
            { id: "64b7f9c2e1a2b3c4d5e6f7a8" }, "e2e-secret", { expiresIn: "2d" }
        );
        const ghostRes = await call("GET", "/api/tasks", { token: ghost });
        assert.strictEqual(ghostRes.status, 401, `deleted-user token should be 401, got ${ghostRes.status}`);
        assert.strictEqual((await call("GET", "/api/auth/profile", { token: ghost })).status, 401);
        assert.strictEqual((await call("GET", "/api/notifications", { token: ghost })).status, 401);
        assert.strictEqual((await call("GET", "/api/tasks", { token: "not-a-jwt" })).status, 401);
        assert.strictEqual((await call("POST", "/api/tasks/upload", { token: M })).status, 400, "upload with no file");
        pass("Auth guards", "401 unauthenticated, 403 role-gated, JSON 404 on unknown API route");


        // ---------- DEPARTMENTS & HEAD-OF-DEPARTMENT HIERARCHY ----------
        // Two departments so we can prove a head is fenced into their own.
        const sales = (await call("POST", "/api/departments", { token: A, body: { name: "Sales" } })).body.department;
        const eng = (await call("POST", "/api/departments", { token: A, body: { name: "Engineering" } })).body.department;
        assert.ok(sales._id && eng._id, "admin can create departments");
        assert.strictEqual(
            (await call("POST", "/api/departments", { token: A, body: { name: "Sales" } })).status, 409,
            "duplicate department name is rejected"
        );

        const headSales = (await call("POST", "/api/auth/register", {
            body: { name: "Hana Head", email: "head@example.test", password: "pw123456", adminInviteToken: HEAD_TOKEN },
        })).body;
        assert.strictEqual(headSales.role, "head", "head invite token grants the head role");
        const H = headSales.token;

        const salesMember = (await call("POST", "/api/auth/register", {
            body: { name: "Sam Sales", email: "sam@example.test", password: "pw123456" },
        })).body;
        const engMember = (await call("POST", "/api/auth/register", {
            body: { name: "Eve Eng", email: "eve@example.test", password: "pw123456" },
        })).body;

        // A head with no department yet can assign to nobody.
        assert.strictEqual(
            (await call("POST", "/api/tasks", {
                token: H, body: { title: "premature", dueDate: day(3), assignedTo: [salesMember._id] },
            })).status, 403,
            "head with no department cannot assign"
        );

        await call("POST", "/api/departments/" + sales._id + "/members", { token: A, body: { userId: headSales._id, head: true } });
        await call("POST", "/api/departments/" + sales._id + "/members", { token: A, body: { userId: salesMember._id } });
        await call("POST", "/api/departments/" + eng._id + "/members", { token: A, body: { userId: engMember._id } });

        // One head per department.
        const secondHead = (await call("POST", "/api/auth/register", {
            body: { name: "Hugo Head", email: "hugo@example.test", password: "pw123456", adminInviteToken: HEAD_TOKEN },
        })).body;
        assert.strictEqual(
            (await call("POST", "/api/departments/" + sales._id + "/members", { token: A, body: { userId: secondHead._id, head: true } })).status,
            409, "a department may only have one head"
        );

        // Members cannot reshape the org chart.
        assert.strictEqual((await call("POST", "/api/departments", { token: M, body: { name: "Rogue" } })).status, 403);
        assert.strictEqual((await call("GET", "/api/departments", { token: M })).status, 403);
        assert.strictEqual(
            (await call("POST", "/api/departments/" + sales._id + "/members", { token: H, body: { userId: engMember._id } })).status,
            403, "a head cannot add members to their own department"
        );

        // A head sees only departments they LEAD.
        const headDepts = (await call("GET", "/api/departments", { token: H })).body.departments;
        assert.strictEqual(headDepts.length, 1, "head sees exactly one department");
        assert.strictEqual(headDepts[0].name, "Sales");
        assert.strictEqual(
            (await call("GET", "/api/departments/" + eng._id + "/members", { token: H })).status, 403,
            "head cannot read another department's members"
        );

        // Assignment hierarchy.
        const headTask = await call("POST", "/api/tasks", {
            token: H, body: { title: "Head assigns in-dept", dueDate: day(3), assignedTo: [salesMember._id] },
        });
        assert.strictEqual(headTask.status, 201, "head assigns to their own member");
        assert.strictEqual(
            (await call("POST", "/api/tasks", {
                token: H, body: { title: "Cross-dept", dueDate: day(3), assignedTo: [engMember._id] },
            })).status, 403,
            "head cannot assign outside their department"
        );
        assert.strictEqual(
            (await call("POST", "/api/tasks", {
                token: A, body: { title: "Admin assigns anywhere", dueDate: day(3), assignedTo: [engMember._id, salesMember._id] },
            })).status, 201,
            "admin assigns across departments"
        );

        // The hole this work closed: PUT /api/tasks/:id used to have no check at all.
        const headTaskId = headTask.body.task._id;
        assert.strictEqual(
            (await call("PUT", "/api/tasks/" + headTaskId, { token: M, body: { title: "hijacked" } })).status, 403,
            "a member cannot edit an arbitrary task"
        );
        assert.strictEqual(
            (await call("PUT", "/api/tasks/" + headTaskId, { token: H, body: { assignedTo: [engMember._id] } })).status, 403,
            "a head cannot reassign out of their department"
        );
        assert.strictEqual(
            (await call("PUT", "/api/tasks/" + headTaskId, { token: H, body: { title: "Head edit" } })).status, 200,
            "a head can edit a task in their department"
        );

        // Dashboard figures are department-scoped, never org-wide.
        const headDash = (await call("GET", "/api/tasks/dashboard-data", { token: H })).body.data;
        const adminDash = (await call("GET", "/api/tasks/dashboard-data", { token: A })).body.data;
        assert.ok(headDash.allTasksCount < adminDash.allTasksCount, "head's task count is scoped, admin's is not");
        assert.strictEqual(headDash.allUsersCount, 2, "head counts only their own department's people");

        // Completion escalates past the task's own people: the assignee's department
        // head is copied even though they neither created it nor were assigned it.
        const escalated = (await call("POST", "/api/tasks", {
            token: A, body: { title: "Quarterly numbers", dueDate: day(4), assignedTo: [salesMember._id] },
        })).body.task;
        assert.strictEqual(
            (await call("PUT", "/api/tasks/" + escalated._id + "/status", {
                token: salesMember.token, body: { status: "Completed" },
            })).status, 200, "assignee completes their own task"
        );

        let headAlerts = [];
        for (let i = 0; i < 10; i += 1) {
            await sleep(300);
            headAlerts = (await call("GET", "/api/notifications?limit=100", { token: H }))
                .body.notifications.filter((n) => /Quarterly numbers is now Completed/.test(n.title));
            if (headAlerts.length) break;
        }
        assert.strictEqual(headAlerts.length, 1, "the department head is copied on a completion, exactly once");
        pass("Completion escalation", "department head notified on a completion they were neither assigned nor created");

        // ---------- REVIEW STEP + RECURRING TASKS ----------
        const SM = salesMember.token;
        const gst = (await call("POST", "/api/tasks", {
            token: A,
            body: {
                title: "File the GST return", dueDate: day(6), assignedTo: [salesMember._id],
                requiresReview: true, recurrence: "monthly",
                todoChecklist: [{ text: "collect invoices", completed: false }],
            },
        })).body.task;
        assert.strictEqual(gst.requiresReview, true);
        assert.strictEqual(gst.recurrence, "monthly");
        assert.strictEqual(
            (await call("POST", "/api/tasks", { token: A, body: { title: "bad", dueDate: day(1), assignedTo: [], recurrence: "hourly" } })).status,
            400, "unknown recurrence is rejected");

        // The assignee finishing sends it for review, not to Completed.
        let r = await call("PUT", `/api/tasks/${gst._id}/status`, { token: SM, body: { status: "Completed" } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.updatedTask.status, "In Review");
        assert.strictEqual(r.body.updatedTask.completedAt, null);
        assert.strictEqual(
            (await call("PUT", `/api/tasks/${gst._id}/status`, { token: SM, body: { status: "In Review" } })).status,
            400, "In Review is set by the server, not requested");

        let reviewAlerts = [];
        for (let i = 0; i < 10; i += 1) {
            await sleep(300);
            reviewAlerts = (await call("GET", "/api/notifications?limit=100", { token: H }))
                .body.notifications.filter((n) => n.type === "review" && /File the GST return/.test(n.title));
            if (reviewAlerts.length) break;
        }
        assert.strictEqual(reviewAlerts.length, 1, "the assignee's head is asked to review");

        assert.strictEqual((await call("GET", `/api/tasks/${gst._id}`, { token: H })).body.canReview, true);
        assert.strictEqual((await call("GET", `/api/tasks/${gst._id}`, { token: SM })).body.canReview, false);
        assert.strictEqual(
            (await call("PUT", `/api/tasks/${gst._id}/review`, { token: SM, body: { action: "approve" } })).status,
            403, "nobody approves their own work");
        assert.strictEqual(
            (await call("PUT", `/api/tasks/${gst._id}/review`, { token: H, body: { action: "maybe" } })).status,
            400, "unknown review action");
        // secondHead ("Hugo Head") heads no department at all - not this task's assignee's department.
        assert.strictEqual(
            (await call("PUT", `/api/tasks/${gst._id}/review`, { token: secondHead.token, body: { action: "approve" } })).status,
            403, "a head of an unrelated department cannot review");

        // Send back with a note: back to In Progress, note lands as a comment.
        r = await call("PUT", `/api/tasks/${gst._id}/review`, { token: H, body: { action: "reject", note: "Attach the challan" } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.task.status, "In Progress");
        assert.strictEqual(r.body.task.comments.at(-1).text, "Attach the challan");
        assert.strictEqual(
            (await call("PUT", `/api/tasks/${gst._id}/review`, { token: H, body: { action: "approve" } })).status,
            400, "only a task in review can be approved");

        // Resubmitting through the checklist also stops at In Review.
        r = await call("PUT", `/api/tasks/${gst._id}/todo`, {
            token: SM, body: { todoChecklist: [{ text: "collect invoices", completed: true }] },
        });
        assert.strictEqual(r.body.task.status, "In Review");

        // Approve: Completed, and exactly one next copy.
        r = await call("PUT", `/api/tasks/${gst._id}/review`, { token: A, body: { action: "approve" } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.task.status, "Completed");
        assert.ok(r.body.task.completedAt, "approval stamps completedAt");
        const nextId = r.body.task.nextTask;
        assert.ok(nextId, "a recurring task spawns its next copy on completion");
        const approvedAt = r.body.task.completedAt;

        // Re-requesting Completed on already-approved work is a no-op, not a fresh
        // submission that could get demoted back to In Review.
        r = await call("PUT", `/api/tasks/${gst._id}/status`, { token: SM, body: { status: "Completed" } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.updatedTask.status, "Completed", "already-completed work isn't demoted back to review");
        assert.strictEqual(r.body.updatedTask.completedAt, approvedAt, "completedAt isn't reset");

        // Same for the checklist route: still 100% must not reopen it either.
        r = await call("PUT", `/api/tasks/${gst._id}/todo`, {
            token: SM, body: { todoChecklist: [{ text: "collect invoices", completed: true }] },
        });
        assert.strictEqual(r.body.task.status, "Completed", "checklist staying at 100% doesn't reopen a completed task");

        const next = (await call("GET", `/api/tasks/${nextId}`, { token: A })).body;
        assert.strictEqual(next.title, "File the GST return");
        assert.strictEqual(next.status, "Pending");
        assert.strictEqual(next.recurrence, "monthly");
        assert.strictEqual(next.requiresReview, true);
        assert.ok(next.todoChecklist.length === 1 && next.todoChecklist.every((t) => !t.completed), "checklist starts unticked");
        assert.ok(new Date(next.dueDate) > new Date(gst.dueDate), "next copy is due later");

        // Reopen and complete again: a reviewer completes directly, and no second copy appears.
        await call("PUT", `/api/tasks/${gst._id}/status`, { token: A, body: { status: "In Progress" } });
        r = await call("PUT", `/api/tasks/${gst._id}/status`, { token: A, body: { status: "Completed" } });
        assert.strictEqual(r.body.updatedTask.status, "Completed", "a reviewer skips their own review");
        assert.strictEqual(String(r.body.updatedTask.nextTask), String(nextId));
        const copies = (await call("GET", "/api/tasks?search=File%20the%20GST%20return", { token: A })).body.tasks;
        assert.strictEqual(copies.length, 2, "re-completing never spawns a second copy");

        const summary = (await call("GET", "/api/tasks", { token: A })).body.statusSummary;
        assert.strictEqual(typeof summary.inReviewTasks, "number", "In Review has its own tab count");
        pass("Review step & recurrence", "submit->review->send back->resubmit->approve; one next copy; reviewer completes directly");

        // ---------- OVERDUE ESCALATION ----------
        const stuck = (await call("POST", "/api/tasks", {
            token: A, body: { title: "Stuck vendor payment", dueDate: day(-5), assignedTo: [salesMember._id] },
        })).body.task;
        const escalationsFor = async (token) => (await call("GET", "/api/notifications?limit=100", { token }))
            .body.notifications.filter((n) => n.type === "escalation" && String(n.task?._id || n.task) === stuck._id);

        let headEsc = [];
        for (let i = 0; i < 20; i += 1) {
            await sleep(1000);
            headEsc = await escalationsFor(H);
            if (headEsc.length) break;
        }
        assert.strictEqual(headEsc.length, 1, "the assignee's head hears about a task stuck overdue");
        assert.strictEqual((await escalationsFor(A)).length, 1, "so does the creator");
        assert.strictEqual((await escalationsFor(SM)).length, 0, "the assignee already gets the overdue alert");

        await sleep(4000);
        assert.strictEqual((await escalationsFor(H)).length, 1, "escalation is sent once, not every scan");

        // A task abandoned long past the escalation window (default 2-9 days) must not
        // alert on every scan after deploy - it's already old news, not a fresh escalation.
        const ancient = (await call("POST", "/api/tasks", {
            token: A, body: { title: "Ancient forgotten invoice", dueDate: day(-30), assignedTo: [salesMember._id] },
        })).body.task;
        const ancientEscalationsFor = async (token) => (await call("GET", "/api/notifications?limit=100", { token }))
            .body.notifications.filter((n) => n.type === "escalation" && String(n.task?._id || n.task) === ancient._id);
        await sleep(4000);
        assert.strictEqual((await ancientEscalationsFor(H)).length, 0, "a task overdue well past the window is not escalated");
        pass("Overdue escalation", "head + creator alerted once when a task is 2+ days overdue");

        // And so is the assignable-people list.
        const headUsers = (await call("GET", "/api/users", { token: H })).body.map((u) => u.email).sort();
        assert.deepStrictEqual(headUsers, ["head@example.test", "sam@example.test"], "head sees only their department");
        assert.strictEqual(
            (await call("GET", "/api/users/" + engMember._id, { token: H })).status, 403,
            "head cannot look up someone outside their department"
        );

        // Deleting a department detaches its members rather than orphaning the ref.
        await call("DELETE", "/api/departments/" + eng._id, { token: A });
        const engAfter = (await call("GET", "/api/users/" + engMember._id, { token: A })).body;
        assert.deepStrictEqual(engAfter.memberships, [],
            "deleting a department drops it from its members' memberships");
        pass("Departments & hierarchy", "admin-only org chart, head fenced to own department, PUT /tasks/:id locked down");
        // --- CSV member import ------------------------------------------
        const importRes = await uploadCsv(A, [
            "name,email,password,department",
            "Imported One,imported.one@e2e.test,secret123,sales",
            '"Two, Imported",imported.two@e2e.test,secret123,',
            "Bad Row,not-an-email,secret123,",
            "Short Pass,short.pass@e2e.test,abc,",
            ",noname@e2e.test,secret123,",
            "Existing Member,member@example.test,secret123,",
            "Ghost Dept,ghost.dept@e2e.test,secret123,Marketing",
            "",
        ].join("\n"));

        assert.strictEqual(importRes.status, 201, `import status ${importRes.status}`);
        assert.strictEqual(importRes.body.created, 2, "only the two clean rows are created");
        assert.strictEqual(importRes.body.skipped, 1, "the already-registered email is skipped, not overwritten");
        assert.deepStrictEqual(
            importRes.body.errors.map((e) => e.line), [4, 5, 6, 8],
            "bad rows are reported by their real line in the file"
        );
        assert.ok(
            /Unknown department: Marketing/.test(importRes.body.errors[3].message),
            "a department that does not exist fails its row instead of importing a department-less user"
        );

        // The whole point of the password column: the new member can actually log in.
        const importedLogin = await call("POST", "/api/auth/login", {
            body: { email: "imported.one@e2e.test", password: "secret123" },
        });
        assert.strictEqual(importedLogin.status, 200, "imported member can log in with the CSV password");
        assert.strictEqual(importedLogin.body.role, "member", "import never grants admin");

        const roster = await call("GET", "/api/users", { token: A });
        const quoted = roster.body.find((u) => u.email === "imported.two@e2e.test");
        assert.ok(quoted, "quoted-name row landed in the member list");
        assert.strictEqual(quoted.name, "Two, Imported", "a comma inside a quoted name does not split the row");
        assert.deepStrictEqual(quoted.memberships, [], "a blank department cell imports as no membership");

        // "sales" in the file must resolve to the "Sales" department created above.
        const placed = roster.body.find((u) => u.email === "imported.one@e2e.test");
        assert.strictEqual(String(placed.memberships[0].department?._id), String(sales._id),
            "department name resolves case-insensitively");
        assert.strictEqual(placed.memberships[0].head, false, "an imported member never arrives as a head");

        // Re-importing the same file must not duplicate anyone.
        const again = await uploadCsv(A, "name,email,password\nImported One,imported.one@e2e.test,secret123\n");
        assert.strictEqual(again.body.created, 0);
        assert.strictEqual(again.body.skipped, 1);

        assert.strictEqual((await uploadCsv(M, "name,email,password\nX,x@e2e.test,secret123\n")).status, 403, "members cannot import");
        assert.strictEqual((await uploadCsv(A, "id,title\n1,nope\n")).status, 400, "a file without the required columns is rejected");
        assert.strictEqual((await uploadCsv(A, "name,email,password\n", "members.txt")).status, 400, "non-csv extension is rejected");
        assert.strictEqual((await call("POST", "/api/users/import", { token: A })).status, 400, "import with no file");
        pass("CSV Member Import", `created ${importRes.body.created}, skipped ${importRes.body.skipped}, ${importRes.body.errors.length} row errors by line; admin-only`);

        // ---------- SALES PIPELINE ----------
        // Fresh actors: this block must not depend on departments earlier
        // blocks create and delete.
        const crm = (await call("POST", "/api/departments", { token: A, body: { name: "CRM" } })).body.department;
        const crmHead = (await call("POST", "/api/auth/register", {
            body: { name: "Hera Head", email: "crmhead@example.test", password: "pw123456", adminInviteToken: HEAD_TOKEN },
        })).body;
        const rep = (await call("POST", "/api/auth/register", {
            body: { name: "Ravi Rep", email: "rep@example.test", password: "pw123456", phone: "98765 11111" },
        })).body;
        const rival = (await call("POST", "/api/auth/register", {
            body: { name: "Rita Rival", email: "rival@example.test", password: "pw123456" },
        })).body;
        for (const u of [crmHead, rep, rival]) {
            await call("POST", "/api/departments/" + crm._id + "/members", {
                // Headship is explicit now - the head role alone does not grant it.
                token: A, body: { userId: u._id, head: String(u._id) === String(crmHead._id) },
            });
        }
        // The CRM department must grant both screens or every call below 403s.
        await call("PUT", "/api/departments/" + crm._id, { token: A, body: { modules: ["sales", "leads"] } });
        const CH = crmHead.token, R = rep.token, RV = rival.token;

        const mkLead = async (token, over = {}) => call("POST", "/api/leads", {
            token,
            body: { company: "ABC Industries", contactName: "Rajesh Sharma", phone: "98765 43210",
                    product: "Firewall", source: "Website", value: 120000, ...over },
        });

        const created = await mkLead(R);
        assert.strictEqual(created.status, 201, `lead create failed: ${created.text}`);
        assert.strictEqual(created.body.lead.stage, "New", "a new lead starts in New");
        assert.strictEqual(String(created.body.lead.owner), String(rep._id), "owner defaults to the caller");
        assert.strictEqual(created.body.lead.phone, "919876543210", "phone is normalised on the way in");
        assert.strictEqual(created.body.lead.history.length, 1, "creation is recorded in history");

        // The invariant: an owned lead always has a next action.
        assert.ok(created.body.task, "creating a lead creates its first follow-up task");
        assert.strictEqual(String(created.body.task.lead), String(created.body.lead._id));
        assert.strictEqual(created.body.task.category, "Sales");
        assert.deepStrictEqual(created.body.task.assignedTo.map(String), [String(rep._id)]);

        // That task is an ordinary task, so it shows up in the rep's normal list.
        const repTasks = await call("GET", "/api/tasks", { token: R });
        assert.ok(repTasks.body.tasks.some((t) => String(t._id) === String(created.body.task._id)),
            "the follow-up is a first-class task in the existing list");

        // A member cannot hand a lead to someone else; admin and head can.
        assert.strictEqual((await mkLead(R, { owner: rival._id })).status, 403, "a member cannot assign a lead away");
        assert.strictEqual((await mkLead(CH, { owner: rep._id })).status, 201, "a head assigns inside their department");
        assert.strictEqual((await mkLead(A, { owner: rival._id })).status, 201, "an admin assigns to anyone");
        assert.strictEqual((await call("POST", "/api/leads", { token: R, body: { contactName: "No Company" } })).status, 400,
            "company is required");

        // An assignment the rep did not make must reach them on WhatsApp.
        await sleep(300);
        assert.ok(wa.received.some((m) => m.to === "919876511111" && /ABC Industries/.test(m.text)),
            "assigning a lead notifies the owner over the existing WhatsApp path");

        // Scope: a rep sees only their own leads, a head sees the department,
        // an admin sees everything.
        const repList = await call("GET", "/api/leads", { token: R });
        assert.ok(repList.body.leads.every((l) => String(l.owner._id) === String(rep._id)),
            "a member sees only leads they own");
        assert.strictEqual(repList.body.leads.length, 2, "the rep owns their own lead plus the one the head assigned");

        const headList = await call("GET", "/api/leads", { token: CH });
        assert.strictEqual(headList.body.leads.length, 3, "a head sees the whole department");

        // The escalation attempt: a query parameter must not widen scope.
        const widened = await call("GET", "/api/leads?owner=" + rival._id, { token: R });
        assert.strictEqual(widened.body.leads.length, 0, "?owner= cannot widen a member's scope");

        // A head narrowing to one rep still works.
        const narrowed = await call("GET", "/api/leads?owner=" + rep._id, { token: CH });
        assert.strictEqual(narrowed.body.leads.length, 2, "a head may filter down to one rep");

        await mkLead(R, { company: "XYZ Hotel", product: "CCTV", source: "Referral", value: 45000 });
        assert.strictEqual((await call("GET", "/api/leads?product=CCTV", { token: R })).body.leads.length, 1);
        assert.strictEqual((await call("GET", "/api/leads?q=hotel", { token: R })).body.leads.length, 1,
            "search is case-insensitive");
        assert.strictEqual((await call("GET", "/api/leads?q=x.z", { token: R })).body.leads.length, 0,
            "regex metacharacters stay literal");

        const abcId = created.body.lead._id;

        const detail = await call("GET", `/api/leads/${abcId}`, { token: R });
        assert.strictEqual(detail.status, 200);
        assert.strictEqual(detail.body.lead.company, "ABC Industries");
        assert.strictEqual(detail.body.tasks.length, 1, "the detail view carries the lead's tasks");

        // A lead outside your scope is indistinguishable from one that is not there.
        assert.strictEqual((await call("GET", `/api/leads/${abcId}`, { token: RV })).status, 404,
            "another rep's lead reads as not found, not as forbidden");
        assert.strictEqual((await call("PUT", `/api/leads/${abcId}`, { token: RV, body: { value: 1 } })).status, 404);
        assert.strictEqual((await call("GET", `/api/leads/${abcId}`, { token: CH })).status, 200,
            "the head of the department can read it");

        const edited = await call("PUT", `/api/leads/${abcId}`, { token: R, body: { value: 150000, contactName: "R. Sharma" } });
        assert.strictEqual(edited.body.lead.value, 150000);
        assert.strictEqual(edited.body.lead.contactName, "R. Sharma");

        // Stage never moves through the generic edit, so every stage change is
        // guaranteed to leave a history line behind.
        const sneaky = await call("PUT", `/api/leads/${abcId}`, { token: R, body: { stage: "Won" } });
        assert.strictEqual(sneaky.body.lead.stage, "New", "PUT /:id ignores stage");

        assert.strictEqual((await call("PUT", `/api/leads/${abcId}`, { token: R, body: { owner: rival._id } })).status, 403,
            "a member cannot hand their lead to someone else");

        assert.strictEqual((await call("DELETE", `/api/leads/${abcId}`, { token: R })).status, 403, "members cannot delete");
        assert.strictEqual((await call("DELETE", `/api/leads/${abcId}`, { token: CH })).status, 403, "heads cannot delete");

        const moved = await call("PUT", `/api/leads/${abcId}/stage`, { token: R, body: { stage: "Proposal", note: "quote sent" } });
        assert.strictEqual(moved.body.lead.stage, "Proposal");
        assert.strictEqual(moved.body.lead.closedAt, null, "an open stage leaves closedAt unset");
        assert.ok(moved.body.lead.history.some((h) => /Proposal/.test(h.text) && /quote sent/.test(h.text)),
            "the stage change and its note land in history");

        const won = await call("PUT", `/api/leads/${abcId}/stage`, { token: R, body: { stage: "Won" } });
        assert.ok(won.body.lead.closedAt, "Won stamps closedAt");

        // A closed deal must stop nagging: its outstanding follow-up would sit in
        // the owner's Overdue list forever otherwise.
        const afterWon = await call("GET", `/api/leads/${abcId}`, { token: R });
        assert.ok(afterWon.body.tasks.length > 0 && afterWon.body.tasks.every((t) => t.status === "Completed"),
            "closing a lead completes its outstanding follow-ups");

        const reopened = await call("PUT", `/api/leads/${abcId}/stage`, { token: R, body: { stage: "Negotiation" } });
        assert.strictEqual(reopened.body.lead.closedAt, null, "moving back off a closed stage clears closedAt");

        // ...and reopening restores the invariant that an owned lead always has
        // a next action, or the lead goes quiet.
        const afterReopen = await call("GET", `/api/leads/${abcId}`, { token: R });
        assert.ok(afterReopen.body.tasks.some((t) => t.status !== "Completed"),
            "reopening a closed lead gives it a fresh follow-up");

        const lost = await call("PUT", `/api/leads/${abcId}/stage`, { token: R, body: { stage: "Lost", lostReason: "price" } });
        assert.strictEqual(lost.body.lead.lostReason, "price");
        assert.ok(lost.body.lead.closedAt, "Lost stamps closedAt too");

        assert.strictEqual((await call("PUT", `/api/leads/${abcId}/stage`, { token: R, body: { stage: "Nonsense" } })).status, 400,
            "an unknown stage is rejected");
        assert.strictEqual((await call("PUT", `/api/leads/${abcId}/stage`, { token: RV, body: { stage: "Won" } })).status, 404,
            "another rep cannot move your lead");

        // A fresh lead so the outcome path starts from New with a live task.
        const fresh = await mkLead(R, { company: "PQR Pvt Ltd", product: "SD-WAN", value: 300000 });
        const pqr = fresh.body.lead._id, pqrTask = fresh.body.task._id;

        const logged = await call("POST", `/api/leads/${pqr}/outcome`, {
            token: R,
            body: { taskId: pqrTask, outcome: "Interested", note: "wants a demo", nextFollowUp: day(2), nextTitle: "Demo — PQR" },
        });
        assert.strictEqual(logged.status, 200, `outcome failed: ${logged.text}`);
        assert.strictEqual(logged.body.lead.stage, "Contacted", "a touch on a New lead advances it to Contacted");
        assert.strictEqual(logged.body.completedTask.status, "Completed", "the referenced task is closed out");
        assert.ok(logged.body.nextTask, "the successor follow-up is created");
        assert.strictEqual(logged.body.nextTask.title, "Demo — PQR");
        assert.strictEqual(logged.body.nextSkipped, false);
        assert.ok(logged.body.lead.history.some((h) => /wants a demo/.test(h.text)));

        // A task belonging to a different lead must never be closeable from here.
        assert.strictEqual((await call("POST", `/api/leads/${pqr}/outcome`, {
            token: R, body: { taskId: created.body.task._id, outcome: "Interested" },
        })).status, 400, "a task from another lead is rejected");

        assert.strictEqual((await call("POST", `/api/leads/${pqr}/outcome`, {
            token: R, body: { outcome: "Maybe" },
        })).status, 400, "an unknown outcome is rejected");

        // Closing the only open task without naming a successor must not leave an
        // open lead with no next action.
        const unnamed = await call("POST", `/api/leads/${pqr}/outcome`, {
            token: R, body: { taskId: logged.body.nextTask._id, outcome: "Follow-up required" },
        });
        assert.strictEqual(unnamed.status, 200, `outcome failed: ${unnamed.text}`);
        assert.ok(unnamed.body.nextTask, "an open lead whose last task was closed gets a default follow-up");

        // Closing the lead must suppress the successor rather than queue dead work.
        const closed = await call("POST", `/api/leads/${pqr}/outcome`, {
            token: R, body: { taskId: unnamed.body.nextTask._id, outcome: "Not interested", nextFollowUp: day(5) },
        });
        assert.strictEqual(closed.body.lead.stage, "Lost");
        assert.ok(closed.body.lead.closedAt, "closing through an outcome stamps closedAt");
        assert.strictEqual(closed.body.nextTask, null, "no follow-up is created on a closed lead");
        assert.strictEqual(closed.body.nextSkipped, true, "and the response says it was skipped");

        const afterClose = await call("GET", `/api/leads/${pqr}`, { token: R });
        assert.ok(afterClose.body.tasks.every((t) => t.status === "Completed"),
            "closing through an outcome also clears the lead's outstanding follow-ups");

        const repPipe = await call("GET", "/api/leads/pipeline", { token: R });
        assert.strictEqual(repPipe.status, 200, `pipeline failed: ${repPipe.text}`);
        assert.strictEqual(repPipe.body.stages.length, 8, "every stage comes back, including the empty ones");
        assert.deepStrictEqual(
            repPipe.body.stages.map((s) => s.stage),
            ["New", "Contacted", "Qualified", "Demo", "Proposal", "Negotiation", "Won", "Lost"],
            "stages arrive in pipeline order so the funnel does not reshuffle"
        );
        assert.ok(repPipe.body.stages.some((s) => s.stage === "Lost" && s.count === 2),
            "both closed leads land in Lost");
        assert.strictEqual(repPipe.body.owners, undefined, "a member gets no per-rep breakdown");

        // Closed value is excluded from pipeline value.
        const openStages = repPipe.body.stages.filter((s) => !["Won", "Lost"].includes(s.stage));
        assert.strictEqual(
            repPipe.body.totals.pipelineValue,
            openStages.reduce((n, s) => n + s.value, 0),
            "pipeline value sums the open stages only"
        );

        const headPipe = await call("GET", "/api/leads/pipeline", { token: CH });
        assert.ok(Array.isArray(headPipe.body.owners), "a head gets the per-rep table");
        const repRow = headPipe.body.owners.find((o) => String(o.owner?._id) === String(rep._id));
        assert.ok(repRow && repRow.owner.name === "Ravi Rep", "rows carry the rep's name, not a bare id");
        assert.ok(headPipe.body.totals.leads >= repPipe.body.totals.leads, "the head's totals cover the department");

        // ---------- DEPARTMENT MODULE ACCESS ----------
        // Marketing grants Leads only; CRM grants both. A rep in BOTH is the
        // case the single-department model could not express at all.
        const mkt = (await call("POST", "/api/departments", { token: A, body: { name: "Mktg" } })).body.department;
        const walled = (await call("POST", "/api/departments", { token: A, body: { name: "Walled" } })).body.department;
        await call("PUT", "/api/departments/" + mkt._id, { token: A, body: { modules: ["leads"] } });
        // `walled` deliberately gets no modules at all.

        const mktHead = (await call("POST", "/api/auth/register", {
            body: { name: "Maya Marketing", email: "mkthead@example.test", password: "pw123456", adminInviteToken: HEAD_TOKEN },
        })).body;
        const walledOff = (await call("POST", "/api/auth/register", {
            body: { name: "Owen Outsider", email: "walledOff@example.test", password: "pw123456" },
        })).body;
        const MH = mktHead.token, OU = walledOff.token;

        await call("POST", "/api/departments/" + mkt._id + "/members", { token: A, body: { userId: mktHead._id, head: true } });
        await call("POST", "/api/departments/" + walled._id + "/members", { token: A, body: { userId: walledOff._id } });
        // The dual-member: already a CRM rep, now also in Marketing.
        await call("POST", "/api/departments/" + mkt._id + "/members", { token: A, body: { userId: rep._id } });

        // A department with no modules ticked loses both screens entirely.
        assert.strictEqual((await call("GET", "/api/leads", { token: OU })).status, 403,
            "a department granting nothing cannot reach the lead list");
        assert.strictEqual((await call("GET", "/api/leads/pipeline", { token: OU })).status, 403,
            "...nor the pipeline");

        // Marketing grants leads but not sales.
        assert.strictEqual((await call("GET", "/api/leads", { token: MH })).status, 200,
            "the marketing head reaches the lead list");
        assert.strictEqual((await call("GET", "/api/leads/pipeline", { token: MH })).status, 403,
            "the marketing head does NOT reach the sales dashboard");

        // Modules are a union: the rep is in CRM (both) and Marketing (leads).
        assert.strictEqual((await call("GET", "/api/leads/pipeline", { token: R })).status, 200,
            "a member of a sales-granting department keeps the dashboard");

        // The accepted consequence of a shared lead pool: leads carry no
        // department, so BOTH of the rep's heads see all of the rep's leads.
        const mktList = await call("GET", "/api/leads", { token: MH });
        assert.ok(mktList.body.leads.some((l) => String(l.owner._id) === String(rep._id)),
            "the marketing head sees the dual-member's leads, including CRM ones");

        // A head's assign rights follow the departments they LEAD. rival is
        // CRM-only, and mktHead heads Marketing, so this must be refused.
        assert.strictEqual(
            (await call("POST", "/api/leads", {
                token: MH,
                body: { company: "Out Of Reach", product: "Internet", source: "Website", owner: rival._id },
            })).status,
            403, "a head cannot assign a lead to someone outside the departments they lead");

        // Headship is not implied by the role, and not granted by joining.
        assert.strictEqual(
            (await call("POST", "/api/departments/" + walled._id + "/members", { token: A, body: { userId: rep._id, head: true } })).status,
            400, "a member cannot be made head of a department");
        assert.strictEqual(
            (await call("POST", "/api/departments/" + mkt._id + "/members", { token: A, body: { userId: rep._id } })).status,
            409, "joining the same department twice is refused");

        // One head per department still holds...
        const spare = (await call("POST", "/api/auth/register", {
            body: { name: "Sam Spare", email: "spare@example.test", password: "pw123456", adminInviteToken: HEAD_TOKEN },
        })).body;
        assert.strictEqual(
            (await call("POST", "/api/departments/" + mkt._id + "/members", { token: A, body: { userId: spare._id, head: true } })).status,
            409, "a department still cannot have two heads");

        // ...but one person heading two departments is now allowed.
        assert.strictEqual(
            (await call("POST", "/api/departments/" + walled._id + "/members", { token: A, body: { userId: mktHead._id, head: true } })).status,
            200, "a head may lead a second department");

        // A head merely a member elsewhere gains no rights there: mktHead heads
        // Marketing and Walled, but is not in CRM, so CRM-only leads owned by
        // rival stay invisible.
        const mktLeads = (await call("GET", "/api/leads", { token: MH })).body.leads;
        assert.ok(!mktLeads.some((l) => String(l.owner._id) === String(rival._id)),
            "a head sees nothing from a department they do not lead or belong to");

        // The profile carries the computed modules, so the client never re-derives them.
        const mktProfile = await call("GET", "/api/auth/profile", { token: MH });
        assert.deepStrictEqual(mktProfile.body.modules, ["leads"], "profile reports the granted modules");
        const adminProfile = await call("GET", "/api/auth/profile", { token: A });
        assert.deepStrictEqual(adminProfile.body.modules.slice().sort(), ["leads", "sales"], "an admin gets everything");

        pass("Module Access", "sales/leads gated per department, dual membership, explicit headship");

        pass("Sales Pipeline", `${headPipe.body.totals.leads} leads: scope isolation, follow-up invariant, stage history, outcomes, funnel`);

        console.log("\n  FEATURE VERIFICATION\n  " + "=".repeat(74));
        results.forEach((r) => console.log(`  [PASS] ${r.feature.padEnd(28)} ${r.detail}`));
        console.log("  " + "=".repeat(74));
        console.log(`  ${results.length}/${results.length} feature groups verified end-to-end against a live server.\n`);
    } catch (error) {
        console.error("\n  FAILED:", error.message);
        if (results.length) {
            console.error("\n  passed before the failure:");
            results.forEach((r) => console.error(`    [PASS] ${r.feature}`));
        }
        console.error("\n  --- server output ---\n" + serverLog.join("").slice(-3000));
        await cleanup();
        process.exit(1);
    }

    await cleanup();
    process.exit(0);
})();
