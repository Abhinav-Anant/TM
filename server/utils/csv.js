/**
 * CSV parsing for the admin bulk-member import.
 * Hand-rolled rather than a dependency: one quoted-field state machine is smaller
 * than the install, and names like "Doe, Jane" must not split a row.
 */

const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_BYTES = 72; // bcrypt silently truncates past this - reject instead of surprising the admin
const REQUIRED_COLUMNS = ["name", "email", "password"];
const OPTIONAL_COLUMNS = ["department"]; // resolved to a Department._id by the caller
const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

// RFC4180-ish: quoted fields, embedded commas/newlines, "" as an escaped quote.
const parseCsv = (text) => {
    const source = String(text).replace(/^﻿/, ""); // Excel writes a BOM
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    let started = false;

    const endField = () => { row.push(field); field = ""; started = true; };
    const endRow = () => { endField(); rows.push(row); row = []; started = false; };

    for (let i = 0; i < source.length; i++) {
        const char = source[i];

        if (quoted) {
            if (char !== '"') { field += char; continue; }
            if (source[i + 1] === '"') { field += '"'; i++; continue; }
            quoted = false;
        } else if (char === '"') {
            quoted = true;
        } else if (char === ",") {
            endField();
        } else if (char === "\n" || char === "\r") {
            if (char === "\r" && source[i + 1] === "\n") i++;
            endRow();
        } else {
            field += char;
            started = true;
        }
    }
    if (started || field) endRow();

    // Blank rows are kept so a row's index still matches its line in the file -
    // the caller reports errors by line number and must not drift off a blank line.
    return rows;
};

const isBlank = (cells) => !cells.some((cell) => cell.trim() !== "");

/**
 * Validates a member CSV without touching the database.
 * Returns { rows, errors } - rows are trimmed and lowercased-email, errors carry
 * the 1-based file line so the admin can find the offending row in their spreadsheet.
 */
const parseMembersCsv = (text) => {
    const table = parseCsv(text);
    if (table.every(isBlank)) return { rows: [], errors: [{ line: 0, message: "File is empty" }] };

    const header = table[0].map((cell) => cell.trim().toLowerCase());
    const missing = REQUIRED_COLUMNS.filter((col) => !header.includes(col));
    if (missing.length > 0) {
        return { rows: [], errors: [{ line: 1, message: `Missing required column(s): ${missing.join(", ")}` }] };
    }

    const index = Object.fromEntries(
        [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].map((col) => [col, header.indexOf(col)])
    );
    const rows = [];
    const errors = [];
    const seen = new Set();

    table.slice(1).forEach((cells, i) => {
        if (isBlank(cells)) return;
        const line = i + 2; // header is line 1
        const name = (cells[index.name] || "").trim();
        const email = (cells[index.email] || "").trim().toLowerCase();
        const password = cells[index.password] || "";
        // Absent column and blank cell both mean "no department" - the caller resolves the name.
        const department = index.department === -1 ? "" : (cells[index.department] || "").trim();

        if (!name) return errors.push({ line, message: "Name is required" });
        if (!EMAIL_RE.test(email)) return errors.push({ line, message: `Invalid email: ${email || "(blank)"}` });
        if (password.length < MIN_PASSWORD_LENGTH) {
            return errors.push({ line, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        }
        if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
            return errors.push({ line, message: `Password must be at most ${MAX_PASSWORD_BYTES} bytes` });
        }
        if (seen.has(email)) return errors.push({ line, message: `Duplicate email in file: ${email}` });

        seen.add(email);
        rows.push({ name, email, password, department, line });
    });

    return { rows, errors };
};

module.exports = { parseCsv, parseMembersCsv, MIN_PASSWORD_LENGTH };
