/**
 * Seeds a demo organisation for showing the app to management, and removes it again.
 *
 *   node server/scripts/seed-demo.js           # create
 *   node server/scripts/seed-demo.js --clean   # remove every trace
 *
 * Two deliberate choices worth knowing before you run it:
 *
 * 1. Every demo person carries the SAME phone number - yours, from DEMO_PHONE.
 *    Invented Indian mobile numbers belong to real people, and with WhatsApp
 *    notifications live a demo would fire real messages at strangers from the
 *    linked account. That is both a nuisance and the fastest way to get the
 *    number banned. Sharing one number you control keeps the demo honest and
 *    lands every alert on a handset you can hold up in the room.
 *
 * 2. Seeding writes through the models, not the controllers, so it sends NOTHING.
 *    Notifications live in the controllers, so the seed is silent and only the
 *    actions you take during the demo will buzz your phone. That is what you
 *    want: no message storm at setup, a live one on stage.
 *
 * Everything created is tagged by the DEMO_DOMAIN email suffix, so --clean is an
 * exact removal rather than a guess. It never touches a user outside that domain.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../model/user.model.js');
const Department = require('../model/department.model.js');
const Task = require('../model/task.model.js');
const { normalizePhone } = require('../utils/phone.js');

const DEMO_DOMAIN = 'demo.leoprime.in';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';
const DEMO_PHONE = process.env.DEMO_PHONE || '919468970009';

// Deliberately NOT "Sales" / "Marketing" / "Technical" / "Accounts": those already
// exist in production with real people in them. Reusing a real department would put
// a demo head in charge of it (the app allows one head per department) and --clean
// would then delete it out from under those real users. Distinct names keep the demo
// hermetic and make removal exact. Rename them in the UI afterwards if you like.
const PEOPLE = [
    { name: 'Priya Raghavan', role: 'head',   department: 'Field Sales' },
    { name: 'Arjun Mehta',    role: 'member', department: 'Field Sales' },
    { name: 'Neha Kulkarni',  role: 'member', department: 'Field Sales' },
    { name: 'Vikram Shah',    role: 'head',   department: 'Product Engineering' },
    { name: 'Ananya Rao',     role: 'member', department: 'Product Engineering' },
    { name: 'Rohit Desai',    role: 'member', department: 'Product Engineering' },
    { name: 'Farah Qureshi',  role: 'head',   department: 'Support Operations' },
    { name: 'Sameer Joshi',   role: 'member', department: 'Support Operations' },
];

const DEPARTMENTS = ['Field Sales', 'Product Engineering', 'Support Operations'];

// Spread across statuses, priorities and dates so the dashboards, the 30-day
// trend chart and the analytics page all have something to draw.
const TASKS = [
    { title: 'Close the Q3 renewal with Vantage Retail', dept: 'Field Sales', owner: 'Arjun Mehta', status: 'In Progress', priority: 'High', due: 3, category: 'Sales' },
    { title: 'Prepare pricing sheet for enterprise tier', dept: 'Field Sales', owner: 'Neha Kulkarni', status: 'Pending', priority: 'Medium', due: 6, category: 'Sales' },
    { title: 'Follow up on 12 inbound leads from the expo', dept: 'Field Sales', owner: 'Arjun Mehta', status: 'Completed', priority: 'Medium', due: -4, category: 'Sales' },
    { title: 'Draft the renewal deck for management review', dept: 'Field Sales', owner: 'Neha Kulkarni', status: 'In Progress', priority: 'Low', due: 9, category: 'Sales' },

    { title: 'Ship the notification service to production', dept: 'Product Engineering', owner: 'Ananya Rao', status: 'Completed', priority: 'High', due: -1, category: 'Development' },
    { title: 'Migrate the reporting job off the nightly cron', dept: 'Product Engineering', owner: 'Rohit Desai', status: 'In Progress', priority: 'High', due: 2, category: 'Development' },
    { title: 'Add rate limiting to the public API', dept: 'Product Engineering', owner: 'Ananya Rao', status: 'Pending', priority: 'Medium', due: 8, category: 'Development' },
    { title: 'Clear the dependency audit warnings', dept: 'Product Engineering', owner: 'Rohit Desai', status: 'Pending', priority: 'Low', due: 14, category: 'Development' },
    { title: 'Write the runbook for the new gateway', dept: 'Product Engineering', owner: 'Ananya Rao', status: 'In Progress', priority: 'Medium', due: 5, category: 'Documentation' },

    { title: 'Renew the office insurance policy', dept: 'Support Operations', owner: 'Sameer Joshi', status: 'Pending', priority: 'High', due: 4, category: 'Operations' },
    { title: 'Onboard the two new joiners for Monday', dept: 'Support Operations', owner: 'Sameer Joshi', status: 'In Progress', priority: 'Medium', due: 1, category: 'Operations' },
    { title: 'Reconcile the Q2 vendor invoices', dept: 'Support Operations', owner: 'Sameer Joshi', status: 'Completed', priority: 'Low', due: -7, category: 'Operations' },
];

const CHECKLISTS = {
    Pending: [['Gather requirements', false], ['Confirm scope with the head', false], ['Schedule the work', false]],
    'In Progress': [['Gather requirements', true], ['Confirm scope with the head', true], ['Deliver first draft', false]],
    Completed: [['Gather requirements', true], ['Deliver first draft', true], ['Sign off', true]],
};

const emailFor = (name) => `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${DEMO_DOMAIN}`;
const daysOut = (n) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(17, 0, 0, 0); return d; };

const connect = async () => {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI is not set - run this from the app directory so .env is picked up');
    await mongoose.connect(uri);
};

const clean = async () => {
    const demoUsers = await User.find({ email: new RegExp(`@${DEMO_DOMAIN.replace(/\./g, '\\.')}$`) }).select('_id');
    const ids = demoUsers.map((u) => u._id);

    // Remove tasks that involve a demo person at all, from either side, so a task
    // an admin assigned to a demo member does not survive as an orphan.
    const tasks = await Task.deleteMany({ $or: [{ assignedTo: { $in: ids } }, { createdBy: { $in: ids } }] });
    const notifications = await mongoose.connection.collection('notifications').deleteMany({ user: { $in: ids } });
    const users = await User.deleteMany({ _id: { $in: ids } });

    // Only remove a demo department once nothing real is left pointing at it.
    // Deleting by name alone would take a live department with real members in it
    // if anyone ever creates one under these names.
    let removedDepartments = 0;
    const kept = [];
    for (const name of DEPARTMENTS) {
        const dept = await Department.findOne({ name });
        if (!dept) continue;
        const remaining = await User.countDocuments({ department: dept._id });
        if (remaining === 0) {
            await Department.deleteOne({ _id: dept._id });
            removedDepartments += 1;
        } else {
            kept.push(`${name} (${remaining} user${remaining === 1 ? '' : 's'} still in it)`);
        }
    }

    console.log(`Removed ${users.deletedCount} demo users, ${tasks.deletedCount} tasks, ` +
        `${notifications.deletedCount} notifications, ${removedDepartments} departments.`);
    if (kept.length) console.log(`Kept, because real people are in them: ${kept.join(', ')}`);
};

const seed = async () => {
    const phone = normalizePhone(DEMO_PHONE);
    if (!phone) throw new Error(`DEMO_PHONE "${DEMO_PHONE}" is not a usable number`);

    const departments = {};
    for (const name of DEPARTMENTS) {
        // Upsert: the admin may already have created a department by this name,
        // and a duplicate would violate the unique index.
        departments[name] = await Department.findOneAndUpdate(
            { name }, { $setOnInsert: { name } }, { upsert: true, new: true }
        );
    }

    const hashed = await bcrypt.hash(DEMO_PASSWORD, 10);
    const people = {};
    for (const person of PEOPLE) {
        const email = emailFor(person.name);
        people[person.name] = await User.findOneAndUpdate(
            { email },
            {
                name: person.name,
                email,
                password: hashed,
                role: person.role,
                phone,
                department: departments[person.department]._id,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    }

    let created = 0;
    for (const spec of TASKS) {
        const owner = people[spec.owner];
        const head = PEOPLE.find((p) => p.role === 'head' && p.department === spec.dept);
        const assigner = people[head.name];

        const existing = await Task.findOne({ title: spec.title });
        if (existing) continue;

        const checklist = CHECKLISTS[spec.status].map(([text, completed]) => ({ text, completed }));
        const done = checklist.filter((i) => i.completed).length;

        await Task.create({
            title: spec.title,
            description: `Demo task for the ${spec.dept} department.`,
            category: spec.category,
            priority: spec.priority,
            status: spec.status,
            dueDate: daysOut(spec.due),
            assignedTo: [owner._id],
            createdBy: [assigner._id],
            todoChecklist: checklist,
            progress: Math.round((done / checklist.length) * 100),
            completedAt: spec.status === 'Completed' ? daysOut(spec.due) : null,
        });
        created += 1;
    }

    console.log(`\nDemo organisation ready.\n`);
    console.log(`  Departments : ${DEPARTMENTS.join(', ')}`);
    console.log(`  People      : ${PEOPLE.length} (3 heads, 5 members)`);
    console.log(`  Tasks       : ${created} created`);
    console.log(`  Password    : ${DEMO_PASSWORD}  (same for everyone)`);
    console.log(`  WhatsApp    : all of them -> ${phone}`);
    console.log(`\n  Sign in as any of:`);
    for (const p of PEOPLE) console.log(`    ${p.role.padEnd(6)} ${emailFor(p.name).padEnd(34)} ${p.department}`);
    console.log(`\n  Remove it all again with:  node server/scripts/seed-demo.js --clean\n`);
};

(async () => {
    try {
        await connect();
        if (process.argv.includes('--clean')) await clean();
        else await seed();
    } catch (error) {
        console.error('Seed failed:', error.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
})();
