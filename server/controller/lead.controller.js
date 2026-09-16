const Lead = require('../model/lead.model.js');
const Task = require('../model/task.model.js');
const { scopeFor, canAssignTo } = require('../utils/scope.js');
const { normalizePhone } = require('../utils/phone.js');
const { notify } = require('../utils/notify.js');

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

module.exports = { createLead, createFollowUp, CLOSED_STAGES };
