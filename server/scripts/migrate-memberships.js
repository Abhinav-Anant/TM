/**
 * One-way migration: `User.department` (a single id) becomes
 * `User.memberships: [{department, head}]`, and the two live departments get
 * their module tick boxes.
 *
 * Idempotent - a user who already has `memberships` is skipped, so a re-run
 * after a partial failure is safe.
 *
 * Uses the raw driver rather than the Mongoose models on purpose: `department`
 * no longer exists on the schema, so a model read cannot see the value this
 * script has to migrate.
 *
 *     node server/scripts/migrate-memberships.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

// Which department grants which screen. Matched by name, once, here - after
// this the tick boxes live in the database and an admin edits them in the UI.
// 'Field Sales' is the team that actually owns every lead on production; the
// empty 'Sales' department is ticked too, ready for when it is staffed.
const GRANTS = {
    Sales: ['sales', 'leads'],
    'Field Sales': ['sales', 'leads'],
    Marketing: ['leads'],
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const users = mongoose.connection.collection('users');
    const departments = mongoose.connection.collection('departments');

    let migrated = 0, skipped = 0;
    for await (const user of users.find({})) {
        if (Array.isArray(user.memberships)) { skipped += 1; continue; }

        // An admin holds no memberships; everyone else keeps the one they had,
        // and heads keep headship of it.
        const memberships = (user.department && user.role !== 'admin')
            ? [{ department: user.department, head: user.role === 'head' }]
            : [];

        await users.updateOne(
            { _id: user._id },
            { $set: { memberships }, $unset: { department: "" } }
        );
        migrated += 1;
    }

    // Default everything to "grants nothing", then tick the two that do.
    await departments.updateMany({ modules: { $exists: false } }, { $set: { modules: [] } });
    for (const [name, modules] of Object.entries(GRANTS)) {
        const result = await departments.updateOne({ name }, { $set: { modules } });
        console.log(`  ${name.padEnd(12)} ${result.matchedCount ? modules.join(', ') : 'NOT FOUND - tick it by hand'}`);
    }

    console.log(`\n  ${migrated} users migrated, ${skipped} already had memberships.`);
    await mongoose.disconnect();
    process.exit(0);
})().catch((error) => { console.error('MIGRATION FAILED:', error.message); process.exit(1); });
