export const BASE_URL = ``;
// export const BASE_URL = `https://task-management-9zav.onrender.com`;


export const API_PATHS = {
    AUTH: {
        REGISTER: "/api/auth/register", // Register a new user (Admin or Member)
        LOGIN: "/api/auth/login", // Authenticate user & return JWT token
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
        GET_ALL_TASKS: "/api/tasks", // Get all tasks (Admin: all, User: only assigned)
        GET_TASK_BY_ID: (taskId) => `/api/tasks/${taskId}`, // Get task by ID
        CREATE_TASK: "/api/tasks", // Create a new task (Admin only)
        UPDATE_TASK: (taskId) => `/api/tasks/${taskId}`, // Update task details
        DELETE_TASK: (taskId) => `/api/tasks/${taskId}`, // Delete a task (Admin only)
        UPDATE_TASK_STATUS: (taskId) => `/api/tasks/${taskId}/status`, // Update task status
        UPDATE_TODO_CHECKLIST: (taskId) => `/api/tasks/${taskId}/todo`, // Update todo checklist
        UPLOAD_ATTACHMENTS: "/api/tasks/upload", // Upload task files (multipart)
        ADD_COMMENT: (taskId) => `/api/tasks/${taskId}/comments`, // Post a comment
        DELETE_COMMENT: (taskId, commentId) => `/api/tasks/${taskId}/comments/${commentId}`,
    },
    DEPARTMENTS: {
        GET_ALL: "/api/departments",                       // Admin: all · Head: own only
        CREATE: "/api/departments",                        // Admin only
        UPDATE: (id) => `/api/departments/${id}`,          // Admin only
        DELETE: (id) => `/api/departments/${id}`,          // Admin only
        GET_MEMBERS: (id) => `/api/departments/${id}/members`,
        ADD_MEMBER: (id) => `/api/departments/${id}/members`,            // { userId }
        REMOVE_MEMBER: (id, userId) => `/api/departments/${id}/members/${userId}`,
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
