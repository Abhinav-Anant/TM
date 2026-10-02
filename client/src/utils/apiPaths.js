export const BASE_URL = ``;
// export const BASE_URL = `https://task-management-9zav.onrender.com`;


export const API_PATHS = {
    AUTH: {
        REGISTER: "/api/auth/register", // Register a new user (Admin or Member)
        LOGIN: "/api/auth/login", // Authenticate user & return JWT token
        LOGOUT: "/api/auth/logout", // Clear the session cookie
        GET_PROFILE: "/api/auth/profile", // Get logged-in user details
        UPDATE_PROFILE: "/api/auth/profile", // Update own name / WhatsApp number
    },
    USERS: {
        GET_ALL_USERS: "/api/users", // Get all users (Admin only)
        GET_USER_BY_ID: (userId) => `/api/users/${userId}`, // Get user by ID
        CREATE_USER: "/api/users", // Create a new user (Admin only)
        IMPORT_MEMBERS: "/api/users/import", // Bulk-create members from a CSV (Admin only)
        UPDATE_USER: (userId) => `/api/users/${userId}`, // Update user details
        DELETE_USER: (userId) => `/api/users/${userId}`, // Delete a user
    },
    TASKS: {
        GET_DASHBOARD_DATA: "/api/tasks/dashboard-data", // Get Dashboard Data
        GET_USER_DASHBOARD_DATA: "/api/tasks/user-dashboard-data", // Get User Dashboard Data
        GET_ANALYTICS: "/api/tasks/analytics", // Progress + completion analytics
        GET_CATEGORIES: "/api/tasks/categories", // Distinct categories in scope
        GET_TAGS: "/api/tasks/tags", // Distinct tags in scope
        MY_DASHBOARD: "/api/tasks/my-dashboard", // Own counts: overdue, due today, in progress, upcoming, done this week
        MANAGER_DASHBOARD: "/api/tasks/manager-dashboard", // Admin/head: totals + per-employee table
        TIME: (taskId) => `/api/tasks/${taskId}/time`, // { estimatedMinutes, actualMinutes }
        TIMER_START: (taskId) => `/api/tasks/${taskId}/timer/start`,
        TIMER_STOP: (taskId) => `/api/tasks/${taskId}/timer/stop`,
        WATCH: (taskId) => `/api/tasks/${taskId}/watch`, // { watching }
        BLOCKED_BY: (taskId) => `/api/tasks/${taskId}/blocked-by`, // { blockedBy: [taskId] }
        SUBTASKS: (taskId) => `/api/tasks/${taskId}/subtasks`, // POST; PUT/DELETE add /:subId
        GET_ALL_TASKS: "/api/tasks", // Get all tasks (Admin: all, User: only assigned)
        GET_TASK_BY_ID: (taskId) => `/api/tasks/${taskId}`, // Get task by ID
        CREATE_TASK: "/api/tasks", // Create a new task (Admin only)
        UPDATE_TASK: (taskId) => `/api/tasks/${taskId}`, // Update task details
        DELETE_TASK: (taskId) => `/api/tasks/${taskId}`, // Delete a task (Admin only)
        UPDATE_TASK_STATUS: (taskId) => `/api/tasks/${taskId}/status`, // Update task status
        REVIEW_TASK: (taskId) => `/api/tasks/${taskId}/review`, // { action: approve|reject, note }
        UPDATE_TODO_CHECKLIST: (taskId) => `/api/tasks/${taskId}/todo`, // Update todo checklist
        UPLOAD_ATTACHMENTS: "/api/tasks/upload", // Upload task files (multipart)
        ADD_COMMENT: (taskId) => `/api/tasks/${taskId}/comments`, // Post a comment
        DELETE_COMMENT: (taskId, commentId) => `/api/tasks/${taskId}/comments/${commentId}`,
    },
    PROJECTS: {
        GET_ALL: "/api/projects",                          // Scoped list with dashboard stats
        CREATE: "/api/projects",                           // Admin / head
        GET_BY_ID: (id) => `/api/projects/${id}`,          // Project + stats + canManage
        UPDATE: (id) => `/api/projects/${id}`,             // Manager / creator / department head / admin
        DELETE: (id) => `/api/projects/${id}`,             // Admin only; tasks are kept
    },
    DEPARTMENTS: {
        GET_ALL: "/api/departments",                       // Admin: all · Head: own only
        CREATE: "/api/departments",                        // Admin only
        UPDATE: (id) => `/api/departments/${id}`,          // Admin only
        DELETE: (id) => `/api/departments/${id}`,          // Admin only
        GET_MEMBERS: (id) => `/api/departments/${id}/members`,
        ADD_MEMBER: (id) => `/api/departments/${id}/members`,            // { userId, head }
        REMOVE_MEMBER: (id, userId) => `/api/departments/${id}/members/${userId}`,
    },
    LEADS: {
        GET_ALL: "/api/leads",                             // Scoped: member=own, head=department, admin=all
        CREATE: "/api/leads",                              // Any signed-in user; owner defaults to self
        GET_PIPELINE: "/api/leads/pipeline",               // Per-stage counts + value, scoped
        GET_BY_ID: (id) => `/api/leads/${id}`,             // Lead + its tasks + history
        UPDATE: (id) => `/api/leads/${id}`,                // Fields only - stage is ignored here
        UPDATE_STAGE: (id) => `/api/leads/${id}/stage`,    // { stage, note, lostReason }
        LOG_OUTCOME: (id) => `/api/leads/${id}/outcome`,   // { taskId, outcome, note, nextFollowUp, nextTitle }
        DELETE: (id) => `/api/leads/${id}`,                // Admin only
    },
    NOTIFICATIONS: {
        GET_ALL: "/api/notifications",
        STREAM: "/api/notifications/stream", // Server-Sent Events live feed
        MARK_READ: (id) => `/api/notifications/${id}/read`,
        MARK_ALL_READ: "/api/notifications/read-all",
        DELETE: (id) => `/api/notifications/${id}`,
    },
    REPORTS: {
        EXPORT_TASKS: '/api/reports/export/tasks',
        EXPORT_USERS: '/api/reports/export/users'
    },
    IMAGE: {
        UPLOAD_IMAGE: 'api/auth/upload-image'
    }
};
