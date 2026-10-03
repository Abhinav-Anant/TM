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


// --- fake SMTP server: proves an email really leaves, to the right person, with the right subject ---
const SMTP_PORT = 4326;
const startSmtp = () => {
    const mails = [];
    const server = net.createServer((socket) => {
        let inData = false, buffer = "", mail = { to: [], raw: "" };
        socket.write("220 fake ESMTP\r\n");
        socket.on("data", (chunk) => {
            buffer += chunk.toString();
            for (;;) {
                if (inData) {
                    const end = buffer.indexOf("\r\n.\r\n");
                    if (end === -1) return;
                    mail.raw = buffer.slice(0, end);
                    buffer = buffer.slice(end + 5);
                    inData = false;
                    mails.push({ to: mail.to, subject: (/^Subject: (.*)$/m.exec(mail.raw) || [])[1] || "", raw: mail.raw });
                    mail = { to: [], raw: "" };
                    socket.write("250 queued\r\n");
                    continue;
                }
                const eol = buffer.indexOf("\r\n");
                if (eol === -1) return;
                const line = buffer.slice(0, eol);
                buffer = buffer.slice(eol + 2);
                const cmd = line.slice(0, 4).toUpperCase();
                if (cmd === "EHLO") socket.write("250-fake\r\n250 8BITMIME\r\n");
                else if (cmd === "RCPT") { mail.to.push(/<(.+)>/.exec(line)[1]); socket.write("250 ok\r\n"); }
                else if (cmd === "DATA") { inData = true; socket.write("354 go\r\n"); }
                else if (cmd === "QUIT") { socket.write("221 bye\r\n"); socket.end(); return; }
                else socket.write("250 ok\r\n");
            }
        });
        socket.on("error", () => {});
    });
    return new Promise((resolve) => server.listen(SMTP_PORT, "127.0.0.1", () => resolve({ server, mails })));
};

// --- fake Expo push service: records messages, reports tokens containing "dead" as unregistered ---
const EXPO_PORT = 4327;
const startExpo = () => {
    const messages = [];
    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
            const batch = JSON.parse(body || "[]");
            messages.push(...batch);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ data: batch.map((m) => (m.to.includes("dead") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" })) }));
        });
    });
    return new Promise((resolve) => server.listen(EXPO_PORT, "127.0.0.1", () => resolve({ server, messages })));
};

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
const call = async (method, url, { token, body, raw, cookie, origin } = {}) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (origin) headers.Origin = origin;
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
    return { status: response.status, body: json, text, headers: response.headers };
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

const multipart = (field, files) => {
    const boundary = `----tmtest${Date.now()}`;
    const parts = [];
    for (const f of files) {
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${f.name}"\r\n` +
            `Content-Type: ${f.type}\r\n\r\n`
        ));
        parts.push(Buffer.from(f.content));
        parts.push(Buffer.from("\r\n"));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return { headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) };
};

const uploadFiles = (token, files) => call("POST", "/api/tasks/upload", { token, raw: multipart("files", files) });

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
    const smtp = await startSmtp();
    const expo = await startExpo();
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
            SMTP_HOST: "127.0.0.1",
            SMTP_PORT: String(SMTP_PORT),
            SMTP_FROM: "tm@example.test",
            EXPO_PUSH_URL: `http://127.0.0.1:${EXPO_PORT}`,
            JOB_POLL_MS: "200",
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
        smtp.server.close();
        expo.server.close();
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
        const A0 = admin.token;
        // Accounts are admin-created now: sign-up is closed once the first admin exists.
        const signUp = async ({ name, email, password, phone }) => {
            const made = await call("POST", "/api/users", { token: A0, body: { name, email, password, phone, role: "member" } });
            assert.strictEqual(made.status, 201, `create user failed: ${made.text}`);
            return (await call("POST", "/api/auth/login", { body: { email, password } })).body;
        };
        const member = (await signUp({ name: "Mo Member", email: "member@example.test", password: "pw123456", phone: "98765 43210" }));
        const outsider = (await signUp({ name: "Otto Outsider", email: "outsider@example.test", password: "pw123456" }));

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

        const byStatus = await call("GET", "/api/tasks?status=To%20Do", { token: A });
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
        const servedPath = upload.body.urls[0];
        assert.ok(servedPath.startsWith("/api/files/"), "attachments are served through the authenticated file route");
        const served = await call("GET", servedPath, { token: M });
        assert.strictEqual(served.status, 200, "uploader can read their file");
        assert.strictEqual(served.text, "acceptance criteria", "served bytes match what was uploaded");

        const rejected = await uploadFiles(M, [{ name: "payload.exe", type: "application/x-msdownload", content: "MZ" }]);
        assert.strictEqual(rejected.status, 400, "disallowed mime type rejected");

        const attached = await call("PUT", `/api/tasks/${design._id}`, { token: A, body: { attachments: upload.body.urls } });
        assert.strictEqual(attached.status, 200);
        assert.strictEqual(attached.body.updatedTask.attachments.length, 2, "attachments saved on the task");
        pass("File Attachments", "multipart upload, served back over /api/files, mime filter, saved on task");

        // ---------- 5b. FILE & SESSION SECURITY ----------
        const secretUrl = upload.body.urls[1]; // budget.csv, attached to `design` (assigned to member)
        assert.strictEqual((await call("GET", secretUrl)).status, 401, "no session, no file");
        assert.strictEqual((await call("GET", secretUrl, { token: O })).status, 404, "a user with no access to the task cannot read its file");
        assert.strictEqual((await call("GET", secretUrl, { token: A })).status, 200, "admin can read it");
        const download = await call("GET", secretUrl, { token: M });
        assert.ok(/^attachment/.test(download.headers.get("content-disposition")), "non-image files are forced to download");
        assert.strictEqual(download.headers.get("x-content-type-options"), "nosniff");

        // an unreferenced upload stays private to its uploader
        const lone = await uploadFiles(O, [{ name: "mine.txt", type: "text/plain", content: "private" }]);
        assert.strictEqual((await call("GET", lone.body.urls[0], { token: O })).status, 200);
        assert.strictEqual((await call("GET", lone.body.urls[0], { token: M })).status, 404, "unattached file is uploader-only");
        assert.strictEqual((await call("GET", "/api/files/not-an-id", { token: A })).status, 404, "bad id is a 404, not a crash");

        // the old public static route is gone
        const legacy = await call("GET", "/uploads/anything.txt");
        assert.ok(legacy.status !== 200 || /<!doctype html/i.test(legacy.text), "/uploads is no longer served (only the SPA shell or an error comes back)");

        // avatar upload needs a session; the result is readable by signed-in users
        assert.strictEqual((await call("POST", "/api/auth/upload-image", { raw: multipart("image", [{ name: "a.png", type: "image/png", content: "PNGDATA" }]) })).status, 401, "anonymous avatar upload rejected");
        const avatar = await call("POST", "/api/auth/upload-image", { token: M, raw: multipart("image", [{ name: "a.png", type: "image/png", content: "PNGDATA" }]) });
        assert.strictEqual(avatar.status, 200);
        assert.strictEqual((await call("GET", avatar.body.imageUrl, { token: O })).status, 200, "avatars are readable by any signed-in user");
        assert.strictEqual((await call("PUT", "/api/auth/profile", { token: M, body: { profileImageUrl: "https://evil.test/x.png" } })).body.profileImageUrl, null, "foreign avatar URLs are ignored");

        // cookie session: HttpOnly Set-Cookie on login, accepted instead of a Bearer header, cleared on logout
        const login = await call("POST", "/api/auth/login", { body: { email: "member@example.test", password: "pw123456" } });
        const setCookie = login.headers.get("set-cookie");
        assert.ok(/tm_token=/.test(setCookie) && /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie), "login sets an HttpOnly SameSite cookie");
        const cookie = setCookie.split(";")[0];
        assert.strictEqual((await call("GET", "/api/auth/profile", { cookie })).status, 200, "cookie authenticates");
        assert.strictEqual((await call("GET", servedPath, { cookie })).status, 200, "cookie lets <img>/<a> reach files");
        assert.ok(/tm_token=;/.test((await call("POST", "/api/auth/logout")).headers.get("set-cookie")), "logout clears the cookie");

        // CORS: unknown origins get no permission headers; failed auth does not leak internals
        const cors = await call("GET", "/api/auth/profile", { origin: "https://evil.test", token: M });
        assert.strictEqual(cors.headers.get("access-control-allow-origin"), null, "no CORS grant for unlisted origins");
        const bad = await call("GET", "/api/auth/profile", { token: "garbage" });
        assert.strictEqual(bad.status, 401);
        assert.strictEqual(bad.body.error, undefined, "token errors are not echoed");
        pass("Files & Session Security", "files need auth + task access, nosniff/attachment, cookie session, CORS closed, no static /uploads");

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
        const signupClosed = await call("POST", "/api/auth/register", { body: { name: "Rando", email: "rando@example.test", password: "pw123456" } });
        assert.strictEqual(signupClosed.status, 403, "open sign-up is closed once an admin exists");

        for (let i = 0; i < 10; i += 1) {
            assert.strictEqual((await call("POST", "/api/auth/login", { body: { email: "throttle@example.test", password: "wrong-pw" } })).status, 401);
        }
        assert.strictEqual((await call("POST", "/api/auth/login", { body: { email: "throttle@example.test", password: "wrong-pw" } })).status, 429, "11th failed login is throttled");
        assert.strictEqual((await call("POST", "/api/auth/login", { body: { email: "throttle@example.test", password: "pw123456" } })).status, 429, "still throttled while the window is open");
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

        const salesMember = (await signUp({ name: "Sam Sales", email: "sam@example.test", password: "pw123456" }));
        const engMember = (await signUp({ name: "Eve Eng", email: "eve@example.test", password: "pw123456" }));

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
        assert.strictEqual(next.status, "To Do");
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

        // --- admin creates a single user ---------------------------------
        const ops = (await call("POST", "/api/departments", { token: A, body: { name: "Ops" } })).body.department;
        const newUser = (body) => call("POST", "/api/users", { token: A, body: { password: "secret123", ...body } });

        const madeMember = await newUser({ name: "Mia Member", email: " Mia.Member@E2E.test ", role: "member", phone: "98765 22222", department: ops._id });
        assert.strictEqual(madeMember.status, 201, `create member status ${madeMember.status}`);
        assert.strictEqual(madeMember.body.user.email, "mia.member@e2e.test", "email is stored trimmed and lowercased");
        assert.strictEqual(madeMember.body.user.phone, "919876522222", "phone is normalised");
        assert.strictEqual(madeMember.body.user.password, undefined, "the password hash never leaves the server");
        assert.deepStrictEqual(madeMember.body.user.memberships.map((m) => [String(m.department), m.head]), [[ops._id, false]]);

        const madeHead = await newUser({ name: "Otto Ops", email: "otto@e2e.test", role: "head", department: ops._id, head: true });
        assert.strictEqual(madeHead.status, 201, `create head status ${madeHead.status}`);
        assert.strictEqual(madeHead.body.user.memberships[0].head, true, "a head can be created as head of a department");
        const madeAdmin = await newUser({ name: "Ada Admin", email: "ada@e2e.test", role: "admin" });
        assert.strictEqual(madeAdmin.status, 201, `create admin status ${madeAdmin.status}`);

        for (const [email, role] of [["mia.member@e2e.test", "member"], ["otto@e2e.test", "head"], ["ada@e2e.test", "admin"]]) {
            const login = await call("POST", "/api/auth/login", { body: { email, password: "secret123" } });
            assert.strictEqual(login.status, 200, `${email} can log in with the admin-set password`);
            assert.strictEqual(login.body.role, role, `${email} has the role the admin picked`);
        }

        assert.strictEqual((await newUser({ name: "Dup", email: "MIA.member@e2e.test", role: "member" })).status, 409, "duplicate email, any case");
        assert.strictEqual((await newUser({ name: "Bad", email: "bad@e2e.test", role: "owner" })).status, 400, "unknown role");
        assert.strictEqual((await newUser({ name: "Short", email: "short@e2e.test", role: "member", password: "123" })).status, 400, "short password");
        assert.strictEqual((await newUser({ name: "Phone", email: "phone@e2e.test", role: "member", phone: "12345" })).status, 400, "junk phone is rejected, not dropped");
        assert.strictEqual((await newUser({ name: "Rep", email: "rep2@e2e.test", role: "member", department: ops._id, head: true })).status, 400, "a member cannot be made head");
        assert.strictEqual((await newUser({ name: "Two", email: "two@e2e.test", role: "head", department: ops._id, head: true })).status, 409, "a department keeps one head");
        assert.strictEqual((await newUser({ name: "Adm", email: "adm2@e2e.test", role: "admin", department: ops._id })).status, 400, "admins do not belong to a department");
        assert.strictEqual((await newUser({ name: "Gone", email: "gone@e2e.test", role: "member", department: "64b000000000000000000000" })).status, 404, "unknown department");
        assert.strictEqual((await call("POST", "/api/auth/login", { body: { email: "two@e2e.test", password: "secret123" } })).status, 401, "a rejected create leaves no account behind");
        assert.strictEqual((await call("POST", "/api/users", { token: M, body: { name: "X", email: "x2@e2e.test", password: "secret123", role: "admin" } })).status, 403, "members cannot create users");
        assert.strictEqual((await call("POST", "/api/users", { token: H, body: { name: "X", email: "x3@e2e.test", password: "secret123", role: "member" } })).status, 403, "heads cannot create users");

        // The person then replaces the admin-set password - but only by proving they know it.
        const miaToken = (await call("POST", "/api/auth/login", { body: { email: "mia.member@e2e.test", password: "secret123" } })).body.token;
        assert.strictEqual((await call("PUT", "/api/auth/profile", { token: miaToken, body: { password: "brandnew99" } })).status, 400, "new password without the current one");
        assert.strictEqual((await call("PUT", "/api/auth/profile", { token: miaToken, body: { password: "brandnew99", currentPassword: "wrong-one" } })).status, 400, "wrong current password is a form error, not a 401 (which logs the client out)");
        assert.strictEqual((await call("PUT", "/api/auth/profile", { token: miaToken, body: { password: "123", currentPassword: "secret123" } })).status, 400, "new password too short");
        assert.strictEqual((await call("PUT", "/api/auth/profile", { token: miaToken, body: { password: "brandnew99", currentPassword: "secret123" } })).status, 200, "password change");
        assert.strictEqual((await call("POST", "/api/auth/login", { body: { email: "mia.member@e2e.test", password: "brandnew99" } })).status, 200, "the new password works");
        assert.strictEqual((await call("POST", "/api/auth/login", { body: { email: "mia.member@e2e.test", password: "secret123" } })).status, 401, "the old one does not");
        pass("Admin creates users", "member/head/admin created with department + headship; same rules as Departments; password change needs the current one");

        // ---------- SALES PIPELINE ----------
        // Fresh actors: this block must not depend on departments earlier
        // blocks create and delete.
        const crm = (await call("POST", "/api/departments", { token: A, body: { name: "CRM" } })).body.department;
        const crmHead = (await call("POST", "/api/auth/register", {
            body: { name: "Hera Head", email: "crmhead@example.test", password: "pw123456", adminInviteToken: HEAD_TOKEN },
        })).body;
        const rep = (await signUp({ name: "Ravi Rep", email: "rep@example.test", password: "pw123456", phone: "98765 11111" }));
        const rival = (await signUp({ name: "Rita Rival", email: "rival@example.test", password: "pw123456" }));
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
        const walledOff = (await signUp({ name: "Owen Outsider", email: "walledoff@example.test", password: "pw123456" }));
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

        // ---------- 5c. SIMPLE TASK MODEL: tags, subtasks, blocked-by, watchers, activity ----------
        const badPriority = await call("POST", "/api/tasks", { token: A, body: { title: "x", assignedTo: [member._id], priority: "Critical" } });
        assert.strictEqual(badPriority.status, 400, "unknown priority rejected");
        assert.strictEqual((await call("POST", "/api/tasks", { token: A, body: { title: "  ", assignedTo: [member._id] } })).status, 400, "blank title rejected");

        // Due date is optional; Urgent is a priority; tags are normalised.
        const web = await mk({ title: "Test website", priority: "Urgent", dueDate: undefined, tags: ["#Website", " website ", "Billing"], startDate: day(0) });
        assert.strictEqual(web.dueDate, null, "a task may have no due date");
        assert.deepStrictEqual(web.tags, ["website", "billing"], "tags lowercased, # stripped, de-duplicated");
        assert.strictEqual(web.priority, "Urgent");
        assert.strictEqual((await call("GET", "/api/tasks?tag=%23Billing", { token: A })).body.tasks.length, 1, "filter by tag");
        assert.deepStrictEqual((await call("GET", "/api/tasks/tags", { token: A })).body.tags, ["billing", "website"]);
        assert.deepStrictEqual((await call("GET", "/api/tasks/tags", { token: O })).body.tags, [], "tag list is scoped to what the user can see");

        // Subtasks: title, assignee, status, due date - embedded, scoped to the parent's people.
        const sub1 = await call("POST", `/api/tasks/${web._id}/subtasks`, { token: M, body: { title: "Design homepage", assignee: member._id, dueDate: day(2) } });
        assert.strictEqual(sub1.status, 201);
        assert.strictEqual((await call("POST", `/api/tasks/${web._id}/subtasks`, { token: M, body: { title: "Develop homepage" } })).body.subtasks.length, 2);
        assert.strictEqual((await call("POST", `/api/tasks/${web._id}/subtasks`, { token: M, body: { title: "x", assignee: outsider._id } })).status, 400, "assignee must already be on the task");
        assert.strictEqual((await call("POST", `/api/tasks/${web._id}/subtasks`, { token: M, body: { title: " " } })).status, 400, "blank subtask title");
        assert.strictEqual((await call("POST", `/api/tasks/${web._id}/subtasks`, { token: O, body: { title: "sneaky" } })).status, 403, "outsiders cannot add subtasks");
        const subId = sub1.body.subtasks[0]._id;
        const subDone = await call("PUT", `/api/tasks/${web._id}/subtasks/${subId}`, { token: M, body: { status: "Completed" } });
        assert.strictEqual(subDone.body.subtasks[0].status, "Completed");
        assert.strictEqual((await call("PUT", `/api/tasks/${web._id}/subtasks/${subId}`, { token: M, body: { status: "Done" } })).status, 400);
        assert.strictEqual((await call("GET", "/api/tasks", { token: A })).body.tasks.every((t) => t.title !== "Design homepage"), true, "subtasks never appear as tasks in lists");
        const subGone = await call("DELETE", `/api/tasks/${web._id}/subtasks/${subDone.body.subtasks[1]._id}`, { token: M });
        assert.strictEqual(subGone.body.subtasks.length, 1);

        // Blocked by: shown as waiting, prevents starting, no loops.
        const deploy = await mk({ title: "Deploy website", dueDate: day(5) });
        const link = await call("PUT", `/api/tasks/${deploy._id}/blocked-by`, { token: A, body: { blockedBy: [web._id] } });
        assert.strictEqual(link.status, 200);
        assert.deepStrictEqual(link.body.waitingFor, ["Test website"]);
        const blockedStart = await call("PUT", `/api/tasks/${deploy._id}/status`, { token: M, body: { status: "In Progress" } });
        assert.strictEqual(blockedStart.status, 409, "cannot start a task that is waiting");
        assert.ok(/Test website/.test(blockedStart.body.message), "the message names what it waits for");
        assert.strictEqual((await call("PUT", `/api/tasks/${deploy._id}/status`, { token: M, body: { status: "Completed" } })).status, 409, "...nor complete it");
        assert.strictEqual((await call("PUT", `/api/tasks/${deploy._id}/status`, { token: M, body: { status: "Blocked" } })).status, 200, "but it can be marked Blocked by hand");
        const listed = (await call("GET", "/api/tasks", { token: A })).body.tasks.find((t) => t._id === deploy._id);
        assert.deepStrictEqual(listed.waitingFor, ["Test website"], "lists carry waitingFor without extra requests");
        assert.strictEqual((await call("PUT", `/api/tasks/${web._id}/blocked-by`, { token: A, body: { blockedBy: [deploy._id] } })).status, 400, "circular dependency refused");
        assert.strictEqual((await call("PUT", `/api/tasks/${web._id}/blocked-by`, { token: A, body: { blockedBy: [web._id] } })).status, 400, "self-dependency refused");
        assert.strictEqual((await call("PUT", `/api/tasks/${deploy._id}/blocked-by`, { token: O, body: { blockedBy: [] } })).status, 403, "outsiders cannot edit links");
        await call("PUT", `/api/tasks/${web._id}/status`, { token: M, body: { status: "Completed" } });
        assert.strictEqual((await call("PUT", `/api/tasks/${deploy._id}/status`, { token: M, body: { status: "In Progress" } })).status, 200, "unblocked once the blocker completes");
        const deployDetail = (await call("GET", `/api/tasks/${deploy._id}`, { token: A })).body;
        assert.deepStrictEqual(deployDetail.waitingFor, [], "nothing to wait for any more");

        // Cancelled work is neither open nor overdue, and does not block anyone.
        const dead = await mk({ title: "Old idea", dueDate: day(-3) });
        assert.strictEqual((await call("GET", "/api/tasks?overdue=true", { token: A })).body.tasks.some((t) => t._id === dead._id), true);
        await call("PUT", `/api/tasks/${dead._id}/status`, { token: A, body: { status: "Cancelled" } });
        assert.strictEqual((await call("GET", "/api/tasks?overdue=true", { token: A })).body.tasks.some((t) => t._id === dead._id), false, "cancelled is never overdue");

        // Watchers: opt in and out; only people who can open the task.
        assert.strictEqual((await call("PUT", `/api/tasks/${web._id}/watch`, { token: O, body: { watching: true } })).status, 403);
        const watching = await call("PUT", `/api/tasks/${web._id}/watch`, { token: A, body: { watching: true } });
        assert.strictEqual(watching.body.isWatching, true);
        assert.strictEqual((await call("GET", `/api/tasks/${web._id}`, { token: A })).body.isWatching, true);
        assert.strictEqual((await call("PUT", `/api/tasks/${web._id}/watch`, { token: A, body: { watching: false } })).body.watchers, 0);

        // Activity timeline: who did what, in order.
        await call("PUT", `/api/tasks/${deploy._id}`, { token: A, body: { priority: "Urgent", dueDate: day(8), assignedTo: [member._id, outsider._id] } });
        await call("POST", `/api/tasks/${deploy._id}/comments`, { token: A, body: { text: "ship it" } });
        await call("PUT", `/api/tasks/${deploy._id}/status`, { token: A, body: { status: "Completed" } });
        await call("PUT", `/api/tasks/${deploy._id}/status`, { token: A, body: { status: "In Progress" } });
        const timeline = (await call("GET", `/api/tasks/${deploy._id}`, { token: A })).body.activity;
        const kinds = timeline.map((e) => e.type);
        ["created", "blocked", "status", "priority", "dueDate", "reassigned", "comment", "completed", "reopened"].forEach((k) =>
            assert.ok(kinds.includes(k), `timeline records "${k}" (got ${kinds.join(",")})`));
        assert.strictEqual(timeline[0].user.name, "Ada Admin", "entries name the actor");
        assert.ok(timeline.find((e) => e.type === "reassigned").text.includes("Otto Outsider"), "assignment names the new assignee");
        assert.strictEqual((await call("GET", "/api/tasks", { token: A })).body.tasks[0].activity, undefined, "lists stay light: no timeline");
        pass("Task model v2", "tags, optional due date, Urgent, subtasks, blocked-by (+409 guard, no loops), Cancelled, watchers, activity timeline");

        // ---------- 5d. PAGINATION ----------
        const everything = await call("GET", "/api/tasks?limit=500&sortBy=priority&sortOrder=desc", { token: A });
        const totalTasks = everything.body.pagination.total;
        assert.strictEqual(everything.body.tasks.length, totalTasks, "limit=500 returns the whole set when it fits");
        assert.ok(totalTasks > 6, "enough tasks exist to page through");

        const rank = { Urgent: 4, High: 3, Medium: 2, Low: 1 };
        for (const sortBy of ["priority", "dueDate", "createdAt"]) {
            const seen = [];
            let pages = 0;
            for (let page = 1; ; page += 1) {
                const res = await call("GET", `/api/tasks?limit=4&page=${page}&sortBy=${sortBy}&sortOrder=desc`, { token: A });
                assert.strictEqual(res.status, 200);
                assert.ok(res.body.tasks.length <= 4, "a page never exceeds its limit");
                assert.strictEqual(res.body.pagination.total, totalTasks);
                seen.push(...res.body.tasks);
                pages = res.body.pagination.pages;
                if (page >= pages) break;
            }
            assert.strictEqual(pages, Math.ceil(totalTasks / 4), `${sortBy}: page count`);
            assert.strictEqual(new Set(seen.map((t) => t._id)).size, totalTasks, `${sortBy}: every task appears exactly once across pages`);
            if (sortBy === "priority") {
                const ranks = seen.map((t) => rank[t.priority]);
                assert.deepStrictEqual(ranks, [...ranks].sort((a, b) => b - a), "priority order holds across page boundaries");
            }
        }

        const beyond = await call("GET", "/api/tasks?limit=4&page=999", { token: A });
        assert.deepStrictEqual(beyond.body.tasks, [], "a page past the end is empty, not an error");
        const capped = await call("GET", "/api/tasks?limit=99999", { token: A });
        assert.strictEqual(capped.body.pagination.limit, 500, "limit is capped");
        const junk = await call("GET", "/api/tasks?page=-3&limit=abc", { token: A });
        assert.strictEqual(junk.body.pagination.page, 1);
        assert.strictEqual(junk.body.pagination.limit, 25, "bad paging params fall back to defaults");

        // a status tab pages over that tab only
        const todoPage = await call("GET", "/api/tasks?status=To%20Do&limit=2", { token: A });
        assert.strictEqual(todoPage.body.pagination.total, todoPage.body.statusSummary.pendingTasks, "tab total matches its tab count");
        // members only page through their own tasks
        const mine = await call("GET", "/api/tasks?limit=3", { token: O });
        assert.ok(mine.body.pagination.total < totalTasks, "paging respects scope");
        pass("Pagination", `${totalTasks} tasks paged stably by priority/due/created; capped, scoped, tab-aware`);

        // ---------- 5e. PROJECTS ----------
        const mkProject = (token, body) => call("POST", "/api/projects", { token, body });
        assert.strictEqual((await mkProject(A, {})).status, 400, "a project needs a name");
        assert.strictEqual((await mkProject(A, { name: "X", status: "Done" })).status, 400, "unknown status refused");
        assert.strictEqual((await mkProject(A, { name: "X", priority: "Meh" })).status, 400, "unknown priority refused");
        assert.strictEqual((await mkProject(A, { name: "X", startDate: day(5), dueDate: day(1) })).status, 400, "due before start refused");
        assert.strictEqual((await mkProject(A, { name: "X", manager: "not-an-id" })).status, 404, "unknown manager refused");
        assert.strictEqual((await mkProject(M, { name: "Sneaky" })).status, 403, "members cannot create projects");
        assert.strictEqual((await mkProject(undefined, { name: "Anon" })).status, 401);

        const pjHead = await call("POST", "/api/auth/register", { body: { name: "Pia Head", email: "pia@example.test", password: "pw123456", adminInviteToken: HEAD_TOKEN } });
        const PH = pjHead.body.token;
        const pjDeptA = (await call("POST", "/api/departments", { token: A, body: { name: "Projects A" } })).body;
        const pjDeptB = (await call("POST", "/api/departments", { token: A, body: { name: "Projects B" } })).body;
        const pjDeptAId = pjDeptA._id || pjDeptA.department?._id;
        const pjDeptBId = pjDeptB._id || pjDeptB.department?._id;
        assert.ok(pjDeptAId && pjDeptBId, "departments created");
        await call("POST", `/api/departments/${pjDeptAId}/members`, { token: A, body: { userId: pjHead.body._id, head: true } });
        const pjMate = await signUp({ name: "Dee Mate", email: "dee@example.test", password: "pw123456" });
        await call("POST", `/api/departments/${pjDeptAId}/members`, { token: A, body: { userId: pjMate._id } });

        const site = await mkProject(A, { name: "Website Development", description: "New site", manager: member._id, members: [member._id], tags: ["#Web"], priority: "High", startDate: day(-5), dueDate: day(30) });
        assert.strictEqual(site.status, 201);
        const siteId = site.body.project._id;
        assert.strictEqual(site.body.project.status, "Planning", "projects start in Planning");
        assert.deepStrictEqual(site.body.project.tags, ["web"]);

        // visibility
        assert.strictEqual((await call("GET", `/api/projects/${siteId}`, { token: M })).status, 200, "the manager sees it");
        assert.strictEqual((await call("GET", `/api/projects/${siteId}`, { token: O })).status, 404, "a stranger gets a 404, not a 403");
        assert.ok(!(await call("GET", "/api/projects", { token: O })).body.projects.some((p) => p._id === siteId), "...and it is not in their list");

        // a head runs their own department's projects only
        const headProj = await mkProject(PH, { name: "Dept A rollout", department: pjDeptAId });
        assert.strictEqual(headProj.status, 201, `head creates in own department: ${headProj.text}`);
        assert.strictEqual((await mkProject(PH, { name: "Poach", department: pjDeptBId })).status, 403, "head cannot use another department");
        const deptProjectId = headProj.body.project._id;
        assert.strictEqual((await call("GET", `/api/projects/${deptProjectId}`, { token: pjMate.token })).status, 200, "department members see the department's projects");
        assert.strictEqual((await call("GET", `/api/projects/${deptProjectId}`, { token: M })).status, 404, "other departments do not");
        assert.strictEqual((await call("PUT", `/api/projects/${deptProjectId}`, { token: pjMate.token, body: { name: "Mine now" } })).status, 403, "viewing is not managing");
        assert.strictEqual((await call("PUT", `/api/projects/${deptProjectId}`, { token: PH, body: { status: "Active" } })).status, 200, "the department head manages it");
        assert.strictEqual((await call("PUT", `/api/projects/${deptProjectId}`, { token: PH, body: { department: pjDeptBId } })).status, 403, "head cannot hand it to a department they do not lead");
        assert.strictEqual((await call("PUT", `/api/projects/${siteId}`, { token: M, body: { status: "Active", description: "Go" } })).status, 200, "the project manager edits");
        assert.strictEqual((await call("PUT", `/api/projects/${siteId}`, { token: O, body: { name: "Hijack" } })).status, 404);

        // tasks inside a project, with the dashboard numbers
        const pjTask = (over) => mk({ project: siteId, ...over });
        const t1 = await pjTask({ title: "Design homepage", status: "In Progress", dueDate: day(-1) });
        const t2 = await pjTask({ title: "Develop homepage", status: "In Progress", dueDate: day(-3) });
        const t3 = await pjTask({ title: "Test homepage", dueDate: day(20) });
        const t4 = await pjTask({ title: "Publish homepage", dueDate: day(3) });
        const t5 = await pjTask({ title: "Scrapped idea", dueDate: day(2) });
        const t6 = await pjTask({ title: "Someday", dueDate: undefined });
        assert.strictEqual(t1.project, siteId, "task keeps its project");
        await call("PUT", `/api/tasks/${t3._id}/blocked-by`, { token: A, body: { blockedBy: [t2._id] } });
        await call("PUT", `/api/tasks/${t1._id}/status`, { token: A, body: { status: "Completed" } });
        await call("PUT", `/api/tasks/${t5._id}/status`, { token: A, body: { status: "Cancelled" } });

        const dash = (await call("GET", `/api/projects/${siteId}`, { token: M })).body;
        assert.deepStrictEqual(
            { total: dash.stats.total, completed: dash.stats.completed, inProgress: dash.stats.inProgress, overdue: dash.stats.overdue, blocked: dash.stats.blocked, dueSoon: dash.stats.dueSoon, progress: dash.stats.progress },
            { total: 5, completed: 1, inProgress: 1, overdue: 1, blocked: 1, dueSoon: 1, progress: 20 },
            "project dashboard: cancelled ignored, blocked counts tasks waiting on open work, undated tasks are never overdue");
        const projList = (await call("GET", "/api/projects", { token: A })).body;
        assert.strictEqual(projList.projects.find((p) => p._id === siteId).stats.total, 5, "the list carries the same stats");
        assert.strictEqual(projList.pagination.total, projList.projects.length);
        assert.strictEqual((await call("GET", "/api/projects?status=Active&search=website", { token: A })).body.projects.length, 1, "filter by status + search");
        assert.strictEqual((await call("GET", "/api/projects?status=Cancelled", { token: A })).body.projects.length, 0);
        assert.strictEqual((await call("GET", `/api/projects/${deptProjectId}`, { token: PH })).body.stats.progress, 0, "an empty project is 0%, not a crash");

        // project task filtering, scoped like every other task list
        const inProject = await call("GET", `/api/tasks?project=${siteId}&limit=50`, { token: A });
        assert.strictEqual(inProject.body.tasks.length, 6, "filter by project");
        assert.ok(inProject.body.tasks.every((t) => t.project?.name === "Website Development"), "tasks carry the project name");
        assert.strictEqual((await call("GET", `/api/tasks?project=${siteId}`, { token: O })).body.tasks.length, 0, "scope still applies inside a project");
        assert.strictEqual((await call("GET", "/api/tasks?project=garbage", { token: A })).body.tasks.length, 0, "a malformed id matches nothing");
        assert.strictEqual((await call("GET", `/api/tasks/${t4._id}`, { token: A })).body.project.name, "Website Development");

        // linking tasks needs a project you can see
        const strange = await call("POST", "/api/tasks", { token: PH, body: { title: "Cross-project", assignedTo: [pjMate._id], project: siteId } });
        assert.strictEqual(strange.status, 404, "cannot file a task under a project you cannot see");
        const pj_moved = await call("PUT", `/api/tasks/${t6._id}`, { token: A, body: { project: null, department: pjDeptAId } });
        assert.strictEqual(pj_moved.body.updatedTask.project, null, "a task can leave its project");
        assert.strictEqual(pj_moved.body.updatedTask.department, pjDeptAId, "and carry a department");
        assert.strictEqual((await call("GET", `/api/tasks?department=${pjDeptAId}`, { token: A })).body.tasks.length, 1, "filter by department");
        assert.strictEqual((await call("PUT", `/api/tasks/${t6._id}`, { token: A, body: { project: "nope" } })).status, 404);

        // delete: admin only, tasks survive
        assert.strictEqual((await call("DELETE", `/api/projects/${siteId}`, { token: M })).status, 403);
        assert.strictEqual((await call("DELETE", `/api/projects/${siteId}`, { token: A })).status, 200);
        assert.strictEqual((await call("GET", `/api/projects/${siteId}`, { token: A })).status, 404);
        assert.strictEqual((await call("GET", `/api/tasks/${t4._id}`, { token: A })).body.project, null, "tasks outlive their project");
        pass("Projects", "CRUD + validation, department visibility, head limits, dashboard stats, project/department task filters, delete keeps tasks");

        // ---------- 5f. MY WORK, DASHBOARDS, TIME TRACKING, REMINDERS ----------
        const dan = await signUp({ name: "Dan Dash", email: "dan@example.test", password: "pw123456" });
        const D = dan.token;
        const todayNoonUtc = new Date(); todayNoonUtc.setUTCHours(12, 0, 0, 0);

        // members may create tasks for themselves only
        const selfMade = await call("POST", "/api/tasks", { token: D, body: { title: "My own errand", assignedTo: [dan._id], dueDate: day(4) } });
        assert.strictEqual(selfMade.status, 201, `member creates for self: ${selfMade.text}`);
        assert.strictEqual((await call("POST", "/api/tasks", { token: D, body: { title: "Not mine", assignedTo: [member._id] } })).status, 403, "...but not for someone else");
        assert.strictEqual((await call("POST", "/api/tasks", { token: D, body: { title: "Mixed", assignedTo: [dan._id, member._id] } })).status, 403, "...nor a mix");
        assert.strictEqual((await call("PUT", `/api/tasks/${selfMade.body.task._id}`, { token: D, body: { title: "Edited" } })).status, 403, "editing the task body is still admin/head");

        const dTask = (over) => mk({ assignedTo: [dan._id], todoChecklist: [], ...over });
        await dTask({ title: "Dan overdue", dueDate: day(-2) });
        await dTask({ title: "Dan today", dueDate: todayNoonUtc.toISOString() });
        await dTask({ title: "Dan active", dueDate: day(3), status: "In Progress" });
        await dTask({ title: "Dan later", dueDate: day(5) });
        const danDone = await dTask({ title: "Dan finished", dueDate: day(1) });
        await call("PUT", `/api/tasks/${danDone._id}/status`, { token: A, body: { status: "Completed" } });
        const danCancelled = await dTask({ title: "Dan cancelled", dueDate: day(-3) });
        await call("PUT", `/api/tasks/${danCancelled._id}/status`, { token: A, body: { status: "Cancelled" } });
        await mk({ title: "Someone else's", assignedTo: [member._id], dueDate: day(-2) });

        const mineDash = (await call("GET", "/api/tasks/my-dashboard?tzOffset=0", { token: D })).body;
        // selfMade is due in 4 days, so it is open + upcoming as well
        assert.deepStrictEqual(
            { open: mineDash.open, overdue: mineDash.overdue, dueToday: mineDash.dueToday, inProgress: mineDash.inProgress, upcoming: mineDash.upcoming, completedThisWeek: mineDash.completedThisWeek },
            { open: 5, overdue: 1, dueToday: 1, inProgress: 1, upcoming: 3, completedThisWeek: 1 },
            "employee dashboard: own tasks only, cancelled ignored, due today is not overdue");
        assert.strictEqual((await call("GET", "/api/tasks/my-dashboard")).status, 401);

        // My Work tabs are plain filters over the same list
        const nowIso = new Date().toISOString();
        const startOfToday = new Date(todayNoonUtc); startOfToday.setUTCHours(0, 0, 0, 0);
        const endOfToday = new Date(startOfToday.getTime() + 24 * 3600 * 1000);
        const tab = async (q) => (await call("GET", `/api/tasks?mine=true&limit=50&${q}`, { token: D })).body.tasks.map((t) => t.title).sort();
        assert.deepStrictEqual(await tab(`open=true&dueBefore=${new Date(startOfToday - 1).toISOString()}`), ["Dan overdue"], "Overdue tab");
        assert.deepStrictEqual(await tab(`open=true&dueAfter=${startOfToday.toISOString()}&dueBefore=${new Date(endOfToday - 1).toISOString()}`), ["Dan today"], "Today tab");
        assert.deepStrictEqual(await tab(`open=true&dueAfter=${endOfToday.toISOString()}`), ["Dan active", "Dan later", "My own errand"], "Upcoming tab");
        assert.deepStrictEqual(await tab("status=Completed"), ["Dan finished"], "Completed tab");
        assert.strictEqual((await tab("")).length, 7, "All tab: everything assigned to me");
        assert.ok(nowIso);

        // mine=true narrows a wide scope; assignee filters inside it
        const adminMine = (await call("GET", "/api/tasks?mine=true&limit=50", { token: A })).body.tasks;
        assert.ok(adminMine.every((t) => t.assignedTo.some((u) => u._id === admin._id)), "an admin's My Work is only theirs");
        const byAssignee = (await call("GET", `/api/tasks?assignee=${dan._id}&limit=50`, { token: A })).body;
        assert.strictEqual(byAssignee.pagination.total, 7, "filter by employee");
        assert.strictEqual((await call("GET", `/api/tasks?assignee=${dan._id}`, { token: O })).body.tasks.length, 0, "the assignee filter cannot widen scope");
        assert.strictEqual((await call("GET", "/api/tasks?assignee=junk", { token: A })).body.tasks.length, 0);

        // manager dashboard: totals + per-employee table, scoped
        assert.strictEqual((await call("GET", "/api/tasks/manager-dashboard", { token: D })).status, 403, "members have no manager dashboard");
        const mgr = (await call("GET", "/api/tasks/manager-dashboard?tzOffset=0", { token: A })).body;
        const danRow = mgr.employees.find((e) => e._id === dan._id);
        assert.deepStrictEqual({ open: danRow.open, overdue: danRow.overdue }, { open: 5, overdue: 1 }, "employee row");
        assert.ok(mgr.totals.open >= 5 && mgr.totals.overdue >= 1 && "blocked" in mgr.totals && "inReview" in mgr.totals && "completedThisWeek" in mgr.totals, "company totals present");
        const p4_sorted = mgr.employees.map((e) => e.overdue);
        assert.deepStrictEqual(p4_sorted, [...p4_sorted].sort((a, b) => b - a), "most overdue first");
        await mk({ title: "Head's team task", assignedTo: [pjMate._id], dueDate: day(-3) });
        const p4_headDash = (await call("GET", "/api/tasks/manager-dashboard", { token: PH })).body;
        assert.ok(p4_headDash.employees.some((e) => e._id === pjMate._id && e.open === 1 && e.overdue === 1), "a head sees their department");
        assert.ok(!p4_headDash.employees.some((e) => e._id === dan._id), "...and nobody outside it");
        assert.ok(p4_headDash.totals.open < mgr.totals.open, "head totals are department-scoped");

        // time tracking
        const timed = await dTask({ title: "Timed job", dueDate: day(6) });
        const T = `/api/tasks/${timed._id}`;
        assert.strictEqual((await call("PUT", `${T}/time`, { token: D, body: { estimatedMinutes: 240 } })).body.estimatedMinutes, 240);
        for (const bad of [-1, 1.5, "4h", 60 * 24 * 400]) {
            assert.strictEqual((await call("PUT", `${T}/time`, { token: D, body: { estimatedMinutes: bad } })).status, 400, `reject estimate ${bad}`);
        }
        assert.strictEqual((await call("PUT", `${T}/time`, { token: O, body: { estimatedMinutes: 5 } })).status, 403, "outsiders cannot track time");
        const racers = await Promise.all([call("POST", `${T}/timer/start`, { token: D }), call("POST", `${T}/timer/start`, { token: D })]);
        assert.deepStrictEqual(racers.map((r) => r.status).sort(), [200, 409], "two simultaneous starts: exactly one wins");
        const other = await dTask({ title: "Second job", dueDate: day(6) });
        const second = await call("POST", `/api/tasks/${other._id}/timer/start`, { token: D });
        assert.strictEqual(second.status, 409, "one running timer per person");
        assert.ok(/Timed job/.test(second.body.message), "says which one is running");
        assert.strictEqual((await call("POST", `${T}/timer/stop`, { token: O })).status, 403);
        const stopped = await call("POST", `${T}/timer/stop`, { token: D });
        assert.strictEqual(stopped.status, 200);
        assert.ok(stopped.body.actualMinutes >= 1 && stopped.body.timerStartedAt === null, "stopping logs at least a minute and clears the timer");
        assert.strictEqual((await call("POST", `${T}/timer/stop`, { token: D })).status, 409, "stopping twice is refused");
        assert.strictEqual((await call("PUT", `${T}/time`, { token: D, body: { actualMinutes: 205 } })).body.actualMinutes, 205, "actual time can be corrected by hand");
        assert.strictEqual((await call("PUT", `${T}/time`, { token: D, body: { estimatedMinutes: null } })).body.estimatedMinutes, null, "an estimate can be removed");
        assert.strictEqual((await call("PUT", `${T}/time`, { token: D, body: { actualMinutes: null } })).status, 400);
        const timeKinds = (await call("GET", T, { token: A })).body.activity.filter((e) => e.type === "time").length;
        assert.ok(timeKinds >= 5, "time changes appear in the timeline");
        assert.strictEqual((await call("POST", `/api/tasks/${other._id}/timer/start`, { token: D })).status, 200, "free to start another after stopping");
        await call("POST", `/api/tasks/${other._id}/timer/stop`, { token: D });

        // reminders: validation, scheduling, one send, re-arm
        assert.strictEqual((await call("POST", "/api/tasks", { token: A, body: { title: "r", assignedTo: [dan._id], reminder: { type: "1h" } } })).status, 400, "a reminder needs a due date");
        assert.strictEqual((await call("POST", "/api/tasks", { token: A, body: { title: "r", assignedTo: [dan._id], dueDate: day(2), reminder: { type: "weekly" } } })).status, 400, "unknown reminder type");
        assert.strictEqual((await call("POST", "/api/tasks", { token: A, body: { title: "r", assignedTo: [dan._id], dueDate: day(2), reminder: { type: "custom", customMinutes: 0 } } })).status, 400, "custom needs minutes");
        const remDue = day(3);
        const remTask = await mk({ title: "Reminder in a day", assignedTo: [dan._id], dueDate: remDue, reminder: { type: "1d" } });
        const remDetail = (await call("GET", `/api/tasks/${remTask._id}`, { token: A })).body;
        assert.strictEqual(new Date(remDetail.remindAt).getTime(), new Date(remDue).getTime() - 24 * 3600 * 1000, "remindAt = due minus the lead time");
        const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // due in 30 min, reminder "1 hour before" => already due to fire
        const remNow = await mk({ title: "Reminder fires now", assignedTo: [dan._id], dueDate: soon, reminder: { type: "1h" } });
        let firstReminders = [];
        for (let i = 0; i < 25 && firstReminders.length === 0; i += 1) {
            await sleep(1000);
            firstReminders = (await call("GET", "/api/notifications?limit=100", { token: D })).body.notifications.filter((n) => n.title === "Reminder: Reminder fires now");
        }
        assert.strictEqual(firstReminders.length, 1, "the reminder is delivered");
        await sleep(7000); // two more scans
        assert.strictEqual((await call("GET", "/api/notifications?limit=100", { token: D })).body.notifications.filter((n) => n.title === "Reminder: Reminder fires now").length, 1, "and only once");
        assert.ok((await call("GET", `/api/tasks/${remNow._id}`, { token: A })).body.reminderSentAt, "the claim is recorded on the task");
        const rearmed = await call("PUT", `/api/tasks/${remNow._id}`, { token: A, body: { dueDate: day(5) } });
        assert.strictEqual(rearmed.body.updatedTask.reminderSentAt, null, "moving the due date re-arms the reminder");
        assert.strictEqual((await call("PUT", `/api/tasks/${remNow._id}`, { token: A, body: { dueDate: null } })).status, 400, "cannot drop the due date while a reminder is set");
        assert.strictEqual((await call("PUT", `/api/tasks/${remNow._id}`, { token: A, body: { reminder: { type: "none" }, dueDate: null } })).status, 200, "...unless the reminder goes too");
        pass("Work & reminders", "My Work filters, employee + manager dashboards (scoped), self-created tasks, timers (atomic, one per person), reminders (once, re-armed)");

        // ---------- 5g. SEARCH, CALENDAR FEED, SAVED FILTERS, BOARD ORDERING ----------
        const p5_zebraProject = (await call("POST", "/api/projects", { token: A, body: { name: "Zebra Launch", dueDate: day(6), manager: member._id } })).body.project;
        const p5_zebraTask = await mk({ title: "Zebra paperwork", tags: ["stripes"], dueDate: day(5) });

        const p5_empty = (await call("GET", "/api/search?q=z", { token: A })).body;
        assert.deepStrictEqual([p5_empty.tasks, p5_empty.projects, p5_empty.people, p5_empty.departments], [[], [], [], []], "one character is not a search");
        const zebra = (await call("GET", "/api/search?q=zebra", { token: A })).body;
        assert.ok(zebra.tasks.some((t) => t._id === p5_zebraTask._id), "finds tasks");
        assert.ok(zebra.projects.some((p) => p._id === p5_zebraProject._id), "finds projects");
        assert.ok((await call("GET", "/api/search?q=%23stripes", { token: A })).body.tasks.some((t) => t._id === p5_zebraTask._id), "finds by #tag");
        assert.strictEqual((await call("GET", "/api/search?q=a.b(%5B", { token: A })).status, 200, "regex characters are literal, not an error");
        const zebraOutsider = (await call("GET", "/api/search?q=zebra", { token: O })).body;
        assert.deepStrictEqual([zebraOutsider.tasks.length, zebraOutsider.projects.length], [0, 0], "search never shows what you cannot open");
        assert.ok((await call("GET", "/api/search?q=zebra", { token: M })).body.projects.length === 1, "...but does for the project's manager");
        assert.strictEqual((await call("GET", "/api/search?q=zebra")).status, 401);

        assert.ok((await call("GET", "/api/search?q=Mo%20Member", { token: A })).body.people.some((u) => u._id === member._id), "admin finds anyone");
        assert.strictEqual((await call("GET", "/api/search?q=Mo%20Member", { token: O })).body.people.length, 0, "a stranger cannot enumerate colleagues");
        assert.strictEqual((await call("GET", "/api/search?q=Otto", { token: O })).body.people.length, 1, "...but can find themselves");
        assert.ok((await call("GET", "/api/search?q=Pia", { token: pjMate.token })).body.people.length === 1, "department colleagues are searchable");
        assert.strictEqual((await call("GET", "/api/search?q=Dan%20Dash", { token: pjMate.token })).body.people.length, 0, "other departments are not");
        assert.strictEqual((await call("GET", "/api/search?q=Projects%20A", { token: A })).body.departments.length, 1);
        assert.strictEqual((await call("GET", "/api/search?q=Projects%20A", { token: pjMate.token })).body.departments.length, 1, "your own department");
        assert.strictEqual((await call("GET", "/api/search?q=Projects%20A", { token: O })).body.departments.length, 0, "not someone else's");

        // calendar feed
        const winStart = day(0).slice(0, 10), winEnd = day(30).slice(0, 10);
        assert.strictEqual((await call("GET", "/api/calendar?start=nope&end=nope", { token: A })).status, 400);
        assert.strictEqual((await call("GET", `/api/calendar?start=${winEnd}&end=${winStart}`, { token: A })).status, 400, "end before start");
        assert.strictEqual((await call("GET", `/api/calendar?start=${day(0)}&end=${day(200)}`, { token: A })).status, 400, "windows are capped");
        const weekly = await mk({ title: "Weekly sales report", dueDate: day(1), recurrence: "weekly" });
        const cal = (await call("GET", `/api/calendar?start=${winStart}&end=${winEnd}T23:59:59Z`, { token: A })).body;
        assert.ok(cal.tasks.some((t) => t._id === p5_zebraTask._id), "calendar carries due tasks");
        assert.ok(cal.projects.some((p) => p._id === p5_zebraProject._id), "...and project deadlines");
        const repeats = cal.recurring.filter((r) => r.taskId === weekly._id);
        assert.strictEqual(repeats.length, 4, "weekly task projects its next four occurrences in a 30-day window");
        assert.ok(repeats.every((r) => new Date(r.dueDate) > new Date(weekly.dueDate)), "projections come after the real due date");
        const calOutsider = (await call("GET", `/api/calendar?start=${winStart}&end=${winEnd}T23:59:59Z`, { token: O })).body;
        assert.ok(!calOutsider.tasks.some((t) => t._id === p5_zebraTask._id) && !calOutsider.projects.some((p) => p._id === p5_zebraProject._id) && !calOutsider.recurring.some((r) => r.taskId === weekly._id), "calendar is scoped like everything else");
        await call("PUT", `/api/tasks/${weekly._id}/status`, { token: A, body: { status: "Cancelled" } });
        const calAfter = (await call("GET", `/api/calendar?start=${winStart}&end=${winEnd}T23:59:59Z`, { token: A })).body;
        assert.strictEqual(calAfter.recurring.filter((r) => r.taskId === weekly._id).length, 0, "a cancelled series stops projecting");

        // saved filters
        const p5_user = await signUp({ name: "Fay Filter", email: "fay@example.test", password: "pw123456" });
        const F = p5_user.token;
        const savedOverdue = await call("POST", "/api/saved-filters", { token: F, body: { name: "My overdue", filters: { overdue: true, mine: true, priority: "High", evil: "x", tag: "" } } });
        assert.strictEqual(savedOverdue.status, 201);
        assert.deepStrictEqual(savedOverdue.body.filter.filters, { overdue: true, mine: true, priority: "High" }, "unknown keys and p5_empty values are dropped");
        assert.strictEqual((await call("POST", "/api/saved-filters", { token: F, body: { name: "My overdue", filters: { priority: "Low" } } })).status, 409, "names are unique per person");
        assert.strictEqual((await call("POST", "/api/saved-filters", { token: F, body: { name: " ", filters: { priority: "Low" } } })).status, 400);
        assert.strictEqual((await call("POST", "/api/saved-filters", { token: F, body: { name: "Nothing", filters: {} } })).status, 400, "an p5_empty filter is not worth saving");
        assert.strictEqual((await call("POST", "/api/saved-filters", { token: F, body: { name: "Junk", filters: { evil: "x" } } })).status, 400);
        assert.strictEqual((await call("GET", "/api/saved-filters", { token: F })).body.filters.length, 1);
        assert.strictEqual((await call("GET", "/api/saved-filters", { token: A })).body.filters.length, 0, "filters are private");
        assert.strictEqual((await call("DELETE", `/api/saved-filters/${savedOverdue.body.filter._id}`, { token: A })).status, 404, "cannot delete someone else's");
        assert.strictEqual((await call("GET", "/api/saved-filters")).status, 401);
        for (let i = 0; i < 19; i += 1) {
            assert.strictEqual((await call("POST", "/api/saved-filters", { token: F, body: { name: `Filter ${i}`, filters: { tag: `t${i}` } } })).status, 201);
        }
        assert.strictEqual((await call("POST", "/api/saved-filters", { token: F, body: { name: "One too many", filters: { tag: "x" } } })).status, 400, "capped at 20");
        assert.strictEqual((await call("DELETE", `/api/saved-filters/${savedOverdue.body.filter._id}`, { token: F })).status, 200);
        assert.strictEqual((await call("GET", "/api/saved-filters", { token: F })).body.filters.length, 19);

        // board: a column is just "status=X", newest completions first
        const p5_first = await mk({ title: "Board done first", dueDate: day(2) });
        await call("PUT", `/api/tasks/${p5_first._id}/status`, { token: A, body: { status: "Completed" } });
        await sleep(30);
        const p5_second = await mk({ title: "Board done second", dueDate: day(2) });
        await call("PUT", `/api/tasks/${p5_second._id}/status`, { token: A, body: { status: "Completed" } });
        const column = (await call("GET", "/api/tasks?status=Completed&sortBy=completedAt&sortOrder=desc&limit=50", { token: A })).body;
        const doneTitles = column.tasks.map((t) => t.title);
        assert.ok(doneTitles.indexOf("Board done second") < doneTitles.indexOf("Board done first"), "Completed column lists the latest finish first");
        assert.ok(column.tasks.every((t) => t.status === "Completed") && column.pagination.total >= 2, "a column only holds its own status");
        // dragging a card is a status change; the rules still apply
        const dragged = await mk({ title: "Drag me", dueDate: day(3) });
        assert.strictEqual((await call("PUT", `/api/tasks/${dragged._id}/status`, { token: M, body: { status: "Blocked" } })).status, 200, "drag to Blocked");
        assert.strictEqual((await call("PUT", `/api/tasks/${dragged._id}/status`, { token: M, body: { status: "In Review" } })).status, 400, "In Review is never a drop target; it comes from Completed");
        assert.strictEqual((await call("PUT", `/api/tasks/${dragged._id}/status`, { token: O, body: { status: "In Progress" } })).status, 403, "and you cannot drag someone else's card");
        pass("Search, calendar, saved filters, board", "scoped search over 4 kinds, calendar feed (tasks, project deadlines, projected repeats), private capped saved filters, board ordering + drag rules");

        // ---------- 6. NOTIFICATION ENGINE: preferences, email, push, queue ----------
        const waitFor = async (probe, ms = 12000) => {
            for (let waited = 0; waited < ms; waited += 250) {
                const hit = probe();
                if (hit) return hit;
                await sleep(250);
            }
            return null;
        };
        const p6_inbox = async (token) => (await call("GET", "/api/notifications?limit=100", { token })).body.notifications;

        const p6_x = await signUp({ name: "Xena Notif", email: "xena@example.test", password: "pw123456", phone: "98765 22222" });
        const p6_y = await signUp({ name: "Yuri Notif", email: "yuri@example.test", password: "pw123456" });
        const X = p6_x.token, Y = p6_y.token;
        const assignTo = (title, people, extra = {}) => mk({ title, assignedTo: people, dueDate: day(8), ...extra });

        // preferences: the table, its defaults and its validation
        assert.strictEqual((await call("GET", "/api/notifications/preferences")).status, 401);
        const prefs0 = (await call("GET", "/api/notifications/preferences", { token: X })).body;
        assert.strictEqual(prefs0.events.length, 14);
        const ev = (table, key) => table.events.find((e) => e.key === key);
        assert.deepStrictEqual([ev(prefs0, "assigned").whatsapp, ev(prefs0, "assigned").email, ev(prefs0, "mention").whatsapp, ev(prefs0, "overdue").email], [true, false, false, true], "spec defaults");
        assert.deepStrictEqual(prefs0.channels, { whatsapp: true, email: true, push: true });
        assert.deepStrictEqual(prefs0.availability, { whatsapp: { configured: true, hasPhone: true }, email: { configured: true }, push: { devices: 0 } });
        assert.strictEqual((await call("GET", "/api/notifications/preferences", { token: Y })).body.availability.whatsapp.hasPhone, false, "availability says when a channel has nothing behind it");
        for (const bad of [{ events: { nope: { email: true } } }, { events: { assigned: { sms: true } } }, { events: { assigned: { email: "yes" } } }, { channels: { inApp: false } }, { channels: { email: 0 } }]) {
            assert.strictEqual((await call("PUT", "/api/notifications/preferences", { token: X, body: bad })).status, 400, `rejects ${JSON.stringify(bad)}`);
        }

        // email: off by default for "assigned", on after opting in, gone after the master switch
        await assignTo("Email default off", [p6_x._id]);
        await sleep(1500);
        assert.ok(!smtp.mails.some((m) => /Email default off/.test(m.subject)), "no email for an event the person has not opted into");
        const optIn = (await call("PUT", "/api/notifications/preferences", { token: X, body: { events: { assigned: { email: true } } } })).body;
        assert.strictEqual(ev(optIn, "assigned").email, true);
        assert.strictEqual(ev((await call("GET", "/api/notifications/preferences", { token: X })).body, "assigned").email, true, "saved");
        await assignTo("Email opted in", [p6_x._id]);
        const sentMail = await waitFor(() => smtp.mails.find((m) => /Email opted in/.test(m.subject)));
        assert.ok(sentMail, "the opted-in email arrives over SMTP");
        assert.deepStrictEqual(sentMail.to, ["xena@example.test"], "addressed to the assignee");
        assert.ok(/\/user\/task-details\//.test(sentMail.raw) || /task-details/.test(sentMail.raw), "and links back to the task");
        await call("PUT", "/api/notifications/preferences", { token: X, body: { channels: { email: false } } });
        const mailsBefore = smtp.mails.length;
        await assignTo("Email muted", [p6_x._id]);
        await sleep(1500);
        assert.strictEqual(smtp.mails.length, mailsBefore, "the master switch silences email even for an opted-in event");
        assert.ok((await p6_inbox(X)).some((n) => n.title.includes("Email muted")), "...but the in-app alert still lands");
        assert.strictEqual(ev((await call("GET", "/api/notifications/preferences", { token: X })).body, "assigned").email, true, "the per-event choice is remembered while muted");
        await call("PUT", "/api/notifications/preferences", { token: X, body: { channels: { email: true } } });

        // WhatsApp: per-event and master switches
        const waTo = (n) => wa.received.filter((m) => m.to === "919876522222" && m.text.includes(n)).length;
        await call("PUT", "/api/notifications/preferences", { token: X, body: { events: { assigned: { whatsapp: false } } } });
        await assignTo("WA event off", [p6_x._id]);
        await sleep(1500);
        assert.strictEqual(waTo("WA event off"), 0, "no WhatsApp when that event's WhatsApp is off");
        assert.ok((await p6_inbox(X)).some((n) => n.title.includes("WA event off")), "in-app unaffected");
        await call("PUT", "/api/notifications/preferences", { token: X, body: { events: { assigned: { whatsapp: true } } } });
        await assignTo("WA event on", [p6_x._id]);
        assert.ok(await waitFor(() => waTo("WA event on") === 1), "WhatsApp flows through the queue when wanted");
        await call("PUT", "/api/notifications/preferences", { token: X, body: { channels: { whatsapp: false } } });
        await assignTo("WA master off", [p6_x._id]);
        await sleep(1500);
        assert.strictEqual(waTo("WA master off"), 0, "the WhatsApp master switch beats everything");
        await call("PUT", "/api/notifications/preferences", { token: X, body: { channels: { whatsapp: true } } });

        // push: registration rules and delivery
        assert.strictEqual((await call("POST", "/api/notifications/push-token", { token: X, body: { token: "not-a-token" } })).status, 400);
        assert.strictEqual((await call("POST", "/api/notifications/push-token", { token: X, body: { token: "ExponentPushToken[xena-phone]" } })).body.devices, 1);
        assert.strictEqual((await call("POST", "/api/notifications/push-token", { token: X, body: { token: "ExponentPushToken[xena-phone]" } })).body.devices, 1, "registering twice is one device");
        assert.strictEqual((await call("POST", "/api/notifications/push-token", { token: Y, body: { token: "ExponentPushToken[xena-phone]" } })).body.devices, 1, "a device that changes hands moves");
        assert.strictEqual((await call("GET", "/api/notifications/preferences", { token: X })).body.availability.push.devices, 0, "...and stops buzzing for the old owner");
        await call("POST", "/api/notifications/push-token", { token: X, body: { token: "ExponentPushToken[xena-tablet]" } });
        await assignTo("Push me", [p6_x._id]);
        const p6_pushed = await waitFor(() => expo.messages.find((m) => /Push me/.test(m.title)));
        assert.ok(p6_pushed, "push reaches the Expo service");
        assert.strictEqual(p6_pushed.to, "ExponentPushToken[xena-tablet]");
        assert.ok(p6_pushed.data.taskId, "and carries the task id so the app can open it");
        await call("PUT", "/api/notifications/preferences", { token: X, body: { events: { assigned: { push: false } } } });
        const pushCount = expo.messages.length;
        await assignTo("Push off", [p6_x._id]);
        await sleep(1500);
        assert.strictEqual(expo.messages.length, pushCount, "per-event push switch is respected");
        await call("PUT", "/api/notifications/preferences", { token: X, body: { events: { assigned: { push: true } } } });
        await call("POST", "/api/notifications/push-token", { token: X, body: { token: "ExponentPushToken[dead-phone]" } });
        await assignTo("Prune dead", [p6_x._id]);
        let devices = 2;
        for (let i = 0; i < 20 && devices !== 1; i += 1) {
            await sleep(300);
            devices = (await call("GET", "/api/notifications/preferences", { token: X })).body.availability.push.devices;
        }
        assert.strictEqual(devices, 1, "a token Expo reports as unregistered is removed");
        for (let i = 0; i < 7; i += 1) await call("POST", "/api/notifications/push-token", { token: X, body: { token: `ExponentPushToken[bulk-${i}]` } });
        assert.strictEqual((await call("GET", "/api/notifications/preferences", { token: X })).body.availability.push.devices, 5, "at most five devices");
        assert.strictEqual((await call("DELETE", "/api/notifications/push-token", { token: X, body: { token: "ExponentPushToken[bulk-6]" } })).status, 200);
        assert.strictEqual((await call("GET", "/api/notifications/preferences", { token: X })).body.availability.push.devices, 4, "devices can be removed");

        // reassigned: whoever is taken off the task is told
        const p6_swap = await assignTo("Swap owners", [p6_x._id]);
        await call("PUT", `/api/tasks/${p6_swap._id}`, { token: A, body: { assignedTo: [p6_y._id] } });
        const xInbox = await p6_inbox(X);
        const reassigned = xInbox.find((n) => n.type === "reassigned" && n.title.includes("Swap owners"));
        assert.ok(reassigned, "the person removed gets a 'reassigned' notification");
        assert.strictEqual(reassigned.event, "reassigned");
        assert.ok((await p6_inbox(Y)).some((n) => n.type === "assigned" && n.title.includes("Swap owners")), "the new owner gets 'assigned'");

        // mentions: only people who can open the task, and no double alert
        const p6_talk = await assignTo("Talk about it", [p6_x._id, p6_y._id]);
        const mention = await call("POST", `/api/tasks/${p6_talk._id}/comments`, { token: A, body: { text: "@Xena please check the firewall", mentions: [p6_x._id, outsider._id, admin._id, "junk"] } });
        assert.strictEqual(mention.status, 201);
        const xn = await p6_inbox(X);
        assert.ok(xn.some((n) => n.type === "mention" && n.title.includes("Talk about it")), "the mentioned person is notified");
        assert.ok(!xn.some((n) => n.type === "comment" && n.title.includes("Talk about it")), "...and not also told 'new comment'");
        assert.ok((await p6_inbox(Y)).some((n) => n.type === "comment" && n.title.includes("Talk about it")), "everyone else gets the normal comment alert");
        assert.ok(!(await p6_inbox(O)).some((n) => n.title.includes("Talk about it")), "a mention cannot reach someone who cannot open the task");
        assert.ok(!(await p6_inbox(A)).some((n) => n.type === "mention"), "you cannot mention yourself");
        const stored = (await call("GET", `/api/tasks/${p6_talk._id}`, { token: A })).body.comments.at(-1);
        assert.deepStrictEqual(stored.mentions, [p6_x._id], "only the valid mention is stored");
        assert.strictEqual(waTo("check the firewall"), 0, "mentions are in-app only by default (no WhatsApp)");

        // approved: the person who did the work hears the approval
        const p6_rev = await assignTo("Needs sign-off", [p6_x._id], { requiresReview: true });
        await call("PUT", `/api/tasks/${p6_rev._id}/status`, { token: X, body: { status: "Completed" } });
        assert.strictEqual((await call("GET", `/api/tasks/${p6_rev._id}`, { token: A })).body.status, "In Review");
        await call("PUT", `/api/tasks/${p6_rev._id}/review`, { token: A, body: { action: "approve" } });
        const approvals = (await p6_inbox(X)).filter((n) => n.title.includes("Needs sign-off"));
        assert.ok(approvals.some((n) => n.type === "approved"), "assignee gets 'approved'");
        assert.ok(!approvals.some((n) => n.type === "status" && n.event === "completed"), "...instead of, not on top of, 'completed'");

        // blocked: marking a task Blocked tells the people on it
        const p6_blk = await assignTo("Stuck work", [p6_y._id]);
        await call("PUT", `/api/tasks/${p6_blk._id}/status`, { token: Y, body: { status: "Blocked" } });
        assert.ok((await p6_inbox(A)).some((n) => n.type === "blocked" && n.title.includes("Stuck work")), "creator hears 'blocked'");
        const p6_dep = await assignTo("Needs the other", [p6_x._id]);
        await call("PUT", `/api/tasks/${p6_dep._id}/blocked-by`, { token: A, body: { blockedBy: [p6_blk._id] } });
        assert.ok((await p6_inbox(X)).some((n) => n.type === "blocked" && n.title.includes("Needs the other")), "linking a blocker tells the assignee");

        // due today vs due tomorrow arrive as different events
        const p6_today = await assignTo("Due later today", [p6_y._id], { dueDate: new Date(Date.now() + 3600 * 1000).toISOString() });
        let dueNotice;
        for (let i = 0; i < 40 && !dueNotice; i += 1) {
            await sleep(500);
            dueNotice = (await p6_inbox(Y)).find((n) => n.task && String(n.task._id || n.task) === p6_today._id && n.type === "deadline");
        }
        assert.ok(dueNotice, "the scheduler raises a deadline alert");
        assert.ok(["due_today", "due_tomorrow"].includes(dueNotice.event), "tagged with a due-date event");
        pass("Notification engine", "preferences (defaults, validation, master switches), email via SMTP, WhatsApp via queue, Expo push (+pruning), reassigned/mention/approved/blocked events");

        // ---------- 7. REPORTS ----------
        const p7_get = (token, path) => call("GET", `/api/reports/${path}`, { token });
        const p7_file = async (token, path) => {
            const response = await fetch(`${BASE}/api/reports/${path}`, { headers: { Authorization: `Bearer ${token}` } });
            return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
        };

        // a small world with known numbers: one department, a head, two employees
        const p7_head = await call("POST", "/api/auth/register", { body: { name: "Rhea Reports", email: "rhea@example.test", password: "pw123456", adminInviteToken: HEAD_TOKEN } });
        const RH = p7_head.body.token;
        const p7_dept = (await call("POST", "/api/departments", { token: A, body: { name: "Reports Dept" } })).body;
        const p7_deptId = p7_dept._id || p7_dept.department._id;
        await call("POST", `/api/departments/${p7_deptId}/members`, { token: A, body: { userId: p7_head.body._id, head: true } });
        const p7_e1 = await signUp({ name: "Eli One", email: "eli@example.test", password: "pw123456" });
        const p7_e2 = await signUp({ name: "Eva Two", email: "eva@example.test", password: "pw123456" });
        for (const e of [p7_e1, p7_e2]) await call("POST", `/api/departments/${p7_deptId}/members`, { token: A, body: { userId: e._id } });
        const p7_project = (await call("POST", "/api/projects", { token: A, body: { name: "=HYPERLINK(\"http://evil.example\")", department: p7_deptId, manager: p7_head.body._id } })).body.project;

        const p7_mk = (assignee, over) => mk({ assignedTo: [assignee._id], todoChecklist: [], ...over });
        const p7_t1 = await p7_mk(p7_e1, { title: "Done on time", dueDate: day(2), project: p7_project._id });
        const p7_t2 = await p7_mk(p7_e1, { title: "Done late", dueDate: day(-3) });
        const p7_t3 = await p7_mk(p7_e1, { title: "Open and overdue", dueDate: day(-2), project: p7_project._id });
        const p7_t4 = await p7_mk(p7_e2, { title: "Open and fine", dueDate: day(5), project: p7_project._id });
        const p7_t5 = await p7_mk(p7_e2, { title: "Stuck", dueDate: day(6) });
        const p7_t6 = await p7_mk(p7_e2, { title: "Scrapped", dueDate: day(6) });
        await call("PUT", `/api/tasks/${p7_t1._id}/status`, { token: A, body: { status: "Completed" } });
        await call("PUT", `/api/tasks/${p7_t2._id}/status`, { token: A, body: { status: "Completed" } });
        await call("PUT", `/api/tasks/${p7_t5._id}/status`, { token: A, body: { status: "Blocked" } });
        await call("PUT", `/api/tasks/${p7_t6._id}/status`, { token: A, body: { status: "Cancelled" } });
        assert.ok(p7_t3 && p7_t4);

        // who may read reports
        assert.strictEqual((await p7_get(undefined, "tasks")).status, 401);
        assert.strictEqual((await p7_get(M, "tasks")).status, 403, "employees have no reports");
        assert.strictEqual((await p7_get(A, "nonsense")).status, 404, "unknown report");

        // Task report, as the department head: only their department's tasks
        const p7_metric = (r, name) => r.body.rows.find((x) => x.metric === name).count;
        const p7_tasks = await p7_get(RH, "tasks");
        assert.strictEqual(p7_tasks.status, 200);
        assert.deepStrictEqual(
            ["Created", "Completed", "Open", "Overdue", "Blocked"].map((m) => p7_metric(p7_tasks, m)),
            [6, 2, 3, 1, 1],
            "task report: created 6, completed 2, open 3 (cancelled excluded), overdue 1, blocked 1");
        assert.strictEqual(p7_tasks.body.trend.reduce((n, d) => n + d.created, 0), 6, "the per-day trend adds up to the same created total");
        assert.ok(p7_tasks.body.trend.length >= 30 && p7_tasks.body.trend.length <= 31, "one row per day of the default 30-day window");
        const p7_adminTasks = await p7_get(A, "tasks");
        assert.ok(p7_metric(p7_adminTasks, "Created") > 6, "an admin sees the whole company");

        // date range: created/completed follow it, open/overdue/blocked are "right now"
        const p7_past = await p7_get(RH, "tasks?from=2024-01-01&to=2024-03-01");
        assert.deepStrictEqual(["Created", "Completed"].map((m) => p7_metric(p7_past, m)), [0, 0], "nothing was created in 2024");
        assert.strictEqual(p7_metric(p7_past, "Open"), 3, "open is current state, whatever the range");
        for (const bad of ["from=junk", "to=2026-02-31", "from=2026-10-08&to=2026-10-01", "from=2020-01-01&to=2026-10-01"]) {
            assert.strictEqual((await p7_get(RH, `tasks?${bad}`)).status, 400, `rejects ${bad}`);
        }

        // Employee report
        const p7_emp = await p7_get(RH, "employees");
        const p7_row = (name) => p7_emp.body.rows.find((r) => r.name === name);
        assert.deepStrictEqual(
            { a: p7_row("Eli One").assigned, c: p7_row("Eli One").completed, t: p7_row("Eli One").onTime, r: p7_row("Eli One").onTimeRate, o: p7_row("Eli One").open, v: p7_row("Eli One").overdue },
            { a: 3, c: 2, t: 1, r: 50, o: 1, v: 1 },
            "Eli: assigned 3, completed 2, one on time (50%), one open and overdue");
        assert.deepStrictEqual(
            { a: p7_row("Eva Two").assigned, c: p7_row("Eva Two").completed, r: p7_row("Eva Two").onTimeRate, o: p7_row("Eva Two").open, v: p7_row("Eva Two").overdue },
            { a: 3, c: 0, r: null, o: 2, v: 0 },
            "Eva: nothing finished, so no on-time rate (null, not 0%); cancelled is not open");
        assert.ok(!p7_emp.body.rows.some((r) => r.name === "Dan Dash"), "a head's employee report holds only their department");
        assert.ok(p7_row("Eli One").departments.includes("Reports Dept"));
        assert.ok((await p7_get(A, "employees")).body.rows.some((r) => r.name === "Dan Dash"), "an admin's holds everyone");
        assert.strictEqual(p7_emp.body.totals.assigned, p7_emp.body.rows.reduce((n, r) => n + r.assigned, 0), "totals row adds up");

        // Department report
        const p7_dep = await p7_get(RH, "departments");
        assert.strictEqual(p7_dep.body.rows.length, 1, "a head sees only their own department");
        assert.deepStrictEqual(
            { open: p7_dep.body.rows[0].open, completed: p7_dep.body.rows[0].completed, overdue: p7_dep.body.rows[0].overdue, blocked: p7_dep.body.rows[0].blocked },
            { open: 3, completed: 2, overdue: 1, blocked: 1 },
            "department: tasks count through their assignees' membership");
        const p7_adminDep = (await p7_get(A, "departments")).body.rows;
        assert.ok(p7_adminDep.length > 1 && p7_adminDep.some((r) => r.name === "No department"), "an admin sees every department plus the unassigned bucket");

        // Project report, equal to the project dashboard
        const p7_proj = await p7_get(RH, "projects");
        const p7_projRow = p7_proj.body.rows.find((r) => r.name.includes("HYPERLINK"));
        assert.deepStrictEqual(
            { open: p7_projRow.open, completed: p7_projRow.completed, overdue: p7_projRow.overdue, progress: p7_projRow.progress },
            { open: 2, completed: 1, overdue: 1, progress: 33 },
            "project: 3 tasks, one done, one overdue, 33% progress");
        assert.strictEqual(p7_projRow.manager, "Rhea Reports");
        assert.ok(!(await p7_get(RH, "projects")).body.rows.some((r) => r.name === "Website Development"), "a head only sees projects they may open");

        // export: CSV and Excel carry the same table
        const p7_csv = await p7_file(RH, "employees?format=csv");
        assert.strictEqual(p7_csv.status, 200);
        assert.ok(/text\/csv/.test(p7_csv.headers.get("content-type")) && /attachment; filename=".*\.csv"/.test(p7_csv.headers.get("content-disposition")));
        const p7_csvText = p7_csv.buffer.toString("utf8");
        assert.ok(p7_csvText.startsWith("\uFEFFEmployee,Email,Departments,Assigned"), "header row, with BOM");
        assert.ok(/Eli One,eli@example.test,Reports Dept,3,2,1,50,1,1/.test(p7_csvText), "a data row matches the screen");
        assert.ok(/\r\nTotal,/.test(p7_csvText), "and the totals row is there");
        const p7_projCsv = (await p7_file(RH, "projects?format=csv")).buffer.toString("utf8");
        assert.ok(p7_projCsv.includes("\"'=HYPERLINK("), "a project named like a formula is exported as text, not as a live formula");
        assert.ok(!/(^|\r\n)=HYPERLINK/.test(p7_projCsv), "no cell starts with =");

        const p7_xlsx = await p7_file(RH, "departments?format=xlsx");
        assert.strictEqual(p7_xlsx.status, 200);
        assert.ok(/spreadsheetml/.test(p7_xlsx.headers.get("content-type")));
        assert.strictEqual(p7_xlsx.buffer.slice(0, 2).toString(), "PK", "a real .xlsx (zip) file");
        const p7_wb = new (require("exceljs").Workbook)();
        await p7_wb.xlsx.load(p7_xlsx.buffer);
        const p7_sheet = p7_wb.worksheets[0];
        assert.deepStrictEqual(p7_sheet.getRow(1).values.slice(1), ["Department", "Open", "Completed", "Overdue", "Blocked"], "Excel headers");
        assert.deepStrictEqual(p7_sheet.getRow(2).values.slice(1), ["Reports Dept", 3, 2, 1, 1], "Excel data row, numbers as numbers");
        assert.strictEqual((await p7_file(M, "departments?format=xlsx")).status, 403, "files are as protected as the screen");

        // the older "download every task" export: scoped, and survives tasks that have no due date
        await mk({ title: "No due date here", dueDate: undefined });
        assert.strictEqual((await p7_file(A, "export/tasks")).status, 200, "export no longer crashes on a task without a due date");
        const p7_headExport = await p7_file(RH, "export/tasks");
        assert.strictEqual(p7_headExport.status, 200, "heads can export too");
        const p7_exportBook = new (require("exceljs").Workbook)();
        await p7_exportBook.xlsx.load(p7_headExport.buffer);
        const p7_titles = p7_exportBook.worksheets[0].getColumn(2).values.slice(2);
        assert.ok(p7_titles.includes("Done on time") && !p7_titles.includes("No due date here"), "...and only gets their department's tasks");
        assert.strictEqual((await p7_file(M, "export/tasks")).status, 403, "members still cannot");
        pass("Reports", "task / employee / department / project reports with exact numbers, scoped for heads, date ranges, CSV (formula-safe) + Excel export");

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
