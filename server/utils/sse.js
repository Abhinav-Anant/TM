// Server-Sent-Events registry for real-time notifications.
// ponytail: in-memory, single-process. Swap for Redis pub/sub if you ever run more than one node.

const clients = new Map(); // userId -> Set<res>

const addClient = (userId, res) => {
    const key = String(userId);
    if (!clients.has(key)) clients.set(key, new Set());
    clients.get(key).add(res);

    return () => {
        const set = clients.get(key);
        if (!set) return;
        set.delete(res);
        if (set.size === 0) clients.delete(key);
    };
};

const push = (userId, payload) => {
    const set = clients.get(String(userId));
    if (!set) return;

    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of set) {
        try {
            res.write(frame);
        } catch (err) {
            set.delete(res);
        }
    }
};

const connectionCount = () => [...clients.values()].reduce((n, s) => n + s.size, 0);

module.exports = { addClient, push, connectionCount };
