/**
 * End-to-end check of every feature added to this project.
 * Boots a real MongoDB (in-memory), a fake SMTP sink and the real `server/index.js`
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
const SMTP_PORT = 4325;
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

const decodeQP = (text) => text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

/**
 * Pulls the text/html alternative out of a raw MIME message.
 * Only this part is rendered as markup - the text/plain sibling is inert,
 * so escaping must be asserted here and nowhere else.
 */
const htmlPartOf = (raw) => {
    const section = raw.split(/Content-Type: text\/html[^\n]*\n/i)[1];
    if (!section) return "";
    const [headers, ...rest] = section.split(/\r?\n\r?\n/);
    const body = rest.join("\n\n");
    return /quoted-printable/i.test(headers) ? decodeQP(body) : body;
};

// --- tiny SMTP sink so we can prove an email actually leaves the app ----------
const startSmtpSink = () => {
    const received = [];
    const server = net.createServer((socket) => {
        let inData = false;
        let body = "";

        socket.write("220 localhost ESMTP sink\r\n");
        socket.on("data", (chunk) => {
            const text = chunk.toString();

            if (inData) {
                body += text;
                if (body.includes("\r\n.\r\n")) {
                    inData = false;
                    received.push(body);
                    body = "";
                    socket.write("250 OK queued\r\n");
                }
                return;
            }

            for (const line of text.split("\r\n").filter(Boolean)) {
                const cmd = line.toUpperCase();
                if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) {
                    socket.write("250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n");
                } else if (cmd.startsWith("AUTH LOGIN")) {
                    socket.write("334 VXNlcm5hbWU6\r\n");
                } else if (cmd.startsWith("AUTH PLAIN")) {
                    socket.write("235 2.7.0 Accepted\r\n");
                } else if (cmd.startsWith("MAIL FROM")) {
                    socket.write("250 OK\r\n");
                } else if (cmd.startsWith("RCPT TO")) {
                    socket.write("250 OK\r\n");
                } else if (cmd.startsWith("DATA")) {
                    inData = true;
                    socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
                } else if (cmd.startsWith("QUIT")) {
                    socket.write("221 Bye\r\n");
                    socket.end();
                } else {
                    // base64 credential lines land here
                    socket.write(/^[A-Za-z0-9+/=]+$/.test(line) ? "235 2.7.0 Accepted\r\n" : "250 OK\r\n");
                }
            }
        });
        socket.on("error", () => {});
    });

    return new Promise((resolve) => {
        server.listen(SMTP_PORT, "127.0.0.1", () => resolve({ server, received }));
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
    const smtp = await startSmtpSink();
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
            SMTP_HOST: "127.0.0.1",
            SMTP_PORT: String(SMTP_PORT),
            SMTP_USER: "sink",
            SMTP_PASS: "sink",
            MAIL_FROM: "tasks@example.test",
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
        smtp.server.close();
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
            body: { name: "Mo Member", email: "member@example.test", password: "pw123456" },
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

        // ---------- 10. EMAIL NOTIFICATIONS ----------
        let mails = smtp.received;
        for (let i = 0; i < 15 && mails.length === 0; i += 1) { await sleep(500); mails = smtp.received; }
        assert.ok(mails.length > 0, "at least one email should have reached the SMTP sink");
        const joined = mails.join("\n");
        assert.ok(/To:.*member@example\.test/i.test(joined), "addressed to the assignee");
        assert.ok(/tasks@example\.test/i.test(joined), "MAIL_FROM honoured");
        assert.ok(/localhost:5173\/user\/task-details\//.test(joined), "deep link back to the task");
        // An alert reads as coming from the person who caused it, while the envelope
        // address stays on our own domain so SPF/DKIM still pass. Reply goes to them.
        assert.ok(/From: "Ada Admin \(Task Manager\)" <tasks@example\.test>/.test(joined),
            "actor name on the From header, app address in the envelope");
        assert.ok(/Reply-To: admin@example\.test/i.test(joined), "replying reaches the assigner directly");
        pass("Email Notifications", `${mails.length} message(s) delivered to the SMTP sink, addressed + deep-linked`);

        // escaping holds on the wire
        const mailsBeforeXss = smtp.received.length;
        await mk({ title: 'Fix <img src=x onerror="alert(1)"> bug', category: "Support", dueDate: day(6) });

        let xssHtml = "";
        let xssPlain = "";
        for (let i = 0; i < 20; i += 1) {
            await sleep(500);
            const fresh = smtp.received.slice(mailsBeforeXss);
            const hit = fresh.find((m) => /img src/.test(m));
            if (hit) { xssHtml = htmlPartOf(hit); xssPlain = hit; break; }
        }

        assert.ok(xssHtml, "the alert email for the crafted title should arrive with an HTML part");
        assert.ok(!/<img src=x onerror/.test(xssHtml), "task titles must not reach the HTML body as live markup");
        assert.ok(/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/.test(xssHtml), "escaped form present instead");
        assert.ok(/text\/plain/.test(xssPlain), "a plain-text alternative is still sent alongside it");
        pass("Email escaping", "task title with markup arrives escaped, not as live HTML");

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

        await call("POST", "/api/departments/" + sales._id + "/members", { token: A, body: { userId: headSales._id } });
        await call("POST", "/api/departments/" + sales._id + "/members", { token: A, body: { userId: salesMember._id } });
        await call("POST", "/api/departments/" + eng._id + "/members", { token: A, body: { userId: engMember._id } });

        // One head per department.
        const secondHead = (await call("POST", "/api/auth/register", {
            body: { name: "Hugo Head", email: "hugo@example.test", password: "pw123456", adminInviteToken: HEAD_TOKEN },
        })).body;
        assert.strictEqual(
            (await call("POST", "/api/departments/" + sales._id + "/members", { token: A, body: { userId: secondHead._id } })).status,
            409, "a department may only have one head"
        );

        // Members cannot reshape the org chart.
        assert.strictEqual((await call("POST", "/api/departments", { token: M, body: { name: "Rogue" } })).status, 403);
        assert.strictEqual((await call("GET", "/api/departments", { token: M })).status, 403);
        assert.strictEqual(
            (await call("POST", "/api/departments/" + sales._id + "/members", { token: H, body: { userId: engMember._id } })).status,
            403, "a head cannot add members to their own department"
        );

        // A head sees only their own department.
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
        assert.strictEqual(engAfter.department, null, "deleting a department clears its members' department");
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
        assert.strictEqual(quoted.department, null, "a blank department cell imports as no department");

        // "sales" in the file must resolve to the "Sales" department created above.
        const placed = roster.body.find((u) => u.email === "imported.one@e2e.test");
        assert.strictEqual(String(placed.department?._id), String(sales._id), "department name resolves case-insensitively");

        // Re-importing the same file must not duplicate anyone.
        const again = await uploadCsv(A, "name,email,password\nImported One,imported.one@e2e.test,secret123\n");
        assert.strictEqual(again.body.created, 0);
        assert.strictEqual(again.body.skipped, 1);

        assert.strictEqual((await uploadCsv(M, "name,email,password\nX,x@e2e.test,secret123\n")).status, 403, "members cannot import");
        assert.strictEqual((await uploadCsv(A, "id,title\n1,nope\n")).status, 400, "a file without the required columns is rejected");
        assert.strictEqual((await uploadCsv(A, "name,email,password\n", "members.txt")).status, 400, "non-csv extension is rejected");
        assert.strictEqual((await call("POST", "/api/users/import", { token: A })).status, 400, "import with no file");
        pass("CSV Member Import", `created ${importRes.body.created}, skipped ${importRes.body.skipped}, ${importRes.body.errors.length} row errors by line; admin-only`);

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
