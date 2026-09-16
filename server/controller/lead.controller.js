const Lead = require('../model/lead.model.js');
const Task = require('../model/task.model.js');
const { scopeFor, canAssignTo } = require('../utils/scope.js');
const { normalizePhone } = require('../utils/phone.js');
const { notify } = require('../utils/notify.js');
const { escapeRegex } = require('./task.controller.js');

const CLOSED_STAGES = ['Won', 'Lost'];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every lead owns a next action. Creating one here is what lets lead alerts
 * reuse notify() untouched: the notification hangs off a real task, so the
 * deep link (/user/task-details/:id) already resolves and no new
 * Notification.type value is needed.
 */
const createFollowUp = async ({ lead, actor, dueDate, title }) => {
    const task = await Task.create({
        title: title || `Follow up — ${lead.company}`,
        description: `${lead.product} · ${lead.stage}`,
        category: "Sales",
        priority: "Medium",
        dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + DAY_MS),
        assignedTo: [lead.owner],
        createdBy: actor._id,
        lead: lead._id,
    });

    // notify() drops the actor, so a rep logging their own lead is not alerted
    // about their own action.
    await notify({
        userIds: [lead.owner],
        actor,
        type: "assigned",
        task: task._id,
        title: `New lead: ${lead.company}`,
        message: `${actor.name} assigned you ${lead.company} (${lead.product}), next action due ${new Date(task.dueDate).toDateString()}.`,
    });

    return task;
};

const createLead = async (req, res) => {
    try {
        const {
            company, contactName, phone, email, source, product, value,
            owner, firstFollowUp, firstTitle,
        } = req.body;

        if (!company || !String(company).trim()) {
            return res.status(400).json({ message: "Company is required" });
        }

        const ownerId = owner || req.user._id;
        if (String(ownerId) !== String(req.user._id)) {
            // Unlike tasks, anyone may create a lead - but only admins and heads
            // may create one owned by somebody else.
            if (req.user.role === "member") {
                return res.status(403).json({ message: "You can only create leads you own" });
            }
            if (!await canAssignTo(req.user, [ownerId])) {
                return res.status(403).json({ message: "You can only assign leads to members of your own department" });
            }
        }

        const lead = await Lead.create({
            company: String(company).trim(),
            contactName, email,
            // An unparseable number degrades reach rather than rejecting the lead,
            // exactly as a user profile behaves.
            phone: normalizePhone(phone),
            source, product,
            value: Number(value) || 0,
            owner: ownerId,
            history: [{ by: req.user._id, text: `Lead created by ${req.user.name}` }],
        });

        const task = await createFollowUp({ lead, actor: req.user, dueDate: firstFollowUp, title: firstTitle });

        res.status(201).json({ message: "Lead created successfully", lead, task });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

/**
 * Mongo filter for a lead list. Pure and synchronous so the smoke suite can
 * cover it without a database, matching buildFilters in task.controller.js.
 *
 * `scope` is spread into an $and rather than merged, so a query parameter can
 * never overwrite it. Merging would let a member widen their own scope with
 * ?owner=<someone else>, which is a privilege escalation, and would also stop a
 * head narrowing to one rep. $and is correct for both.
 */
const buildLeadFilters = (scope, query = {}) => {
    const filter = {};
    const { stage, owner, product, source, q } = query;

    const set = (key, value) => {
        if (value && value !== "All" && String(value).trim()) filter[key] = value;
    };
    set("stage", stage);
    set("product", product);
    set("source", source);
    set("owner", owner);

    if (q && String(q).trim()) {
        const rx = new RegExp(escapeRegex(String(q).trim()), "i");
        filter.$or = [{ company: rx }, { contactName: rx }];
    }

    if (!Object.keys(scope).length) return filter;
    if (!Object.keys(filter).length) return { ...scope };
    return { $and: [filter, scope] };
};

const listLeads = async (req, res) => {
    try {
        const scope = await scopeFor(req.user, 'owner');
        const filter = buildLeadFilters(scope, req.query);

        const leads = await Lead.find(filter)
            .populate("owner", "name email")
            .sort({ createdAt: -1 })
            .lean();

        res.json({ leads, total: leads.length });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

/**
 * The scope filter is the authorization check. A lead outside the caller's
 * scope returns null and the route answers 404, so an out-of-scope lead is
 * indistinguishable from a missing one.
 */
const findScopedLead = async (req) => {
    const scope = await scopeFor(req.user, 'owner');
    return Lead.findOne({ _id: req.params.id, ...scope });
};

const getLeadById = async (req, res) => {
    try {
        const lead = await Lead.findOne({ _id: req.params.id, ...await scopeFor(req.user, 'owner') })
            .populate("owner", "name email")
            .populate("history.by", "name");
        if (!lead) return res.status(404).json({ message: "Lead not found" });

        const tasks = await Task.find({ lead: lead._id })
            .populate("assignedTo", "name email")
            .sort({ dueDate: 1 })
            .lean();

        res.json({ lead, tasks });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const updateLead = async (req, res) => {
    try {
        const lead = await findScopedLead(req);
        if (!lead) return res.status(404).json({ message: "Lead not found" });

        const { company, contactName, phone, email, source, product, value, owner } = req.body;

        if (owner && String(owner) !== String(lead.owner)) {
            if (req.user.role === "member") {
                return res.status(403).json({ message: "You cannot reassign a lead" });
            }
            if (!await canAssignTo(req.user, [owner])) {
                return res.status(403).json({ message: "You can only assign leads to members of your own department" });
            }
            lead.owner = owner;
            lead.history.push({ by: req.user._id, text: `Reassigned by ${req.user.name}` });
        }

        if (company !== undefined) lead.company = String(company).trim();
        if (contactName !== undefined) lead.contactName = contactName;
        if (phone !== undefined) lead.phone = normalizePhone(phone);
        if (email !== undefined) lead.email = email;
        if (source !== undefined) lead.source = source;
        if (product !== undefined) lead.product = product;
        if (value !== undefined) lead.value = Number(value) || 0;
        // `stage` is deliberately absent: it moves only through PUT /:id/stage,
        // which is what guarantees every stage change appends history.

        await lead.save();
        res.json({ message: "Lead updated successfully", lead });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const deleteLead = async (req, res) => {
    try {
        const lead = await Lead.findByIdAndDelete(req.params.id);
        if (!lead) return res.status(404).json({ message: "Lead not found" });

        // The follow-ups have no meaning without the lead they hang off.
        await Task.deleteMany({ lead: lead._id });
        res.json({ message: "Lead deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

module.exports = {
    createLead, listLeads, getLeadById, updateLead, deleteLead,
    createFollowUp, findScopedLead, buildLeadFilters, CLOSED_STAGES,
};
