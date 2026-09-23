import {
  LuLayoutDashboard, LuClipboardCheck, LuSquarePlus, LuLogOut, LuUsers,
  LuCalendarDays, LuChartColumnBig, LuBuilding2, LuSmartphone,
  LuTrendingUp, LuContact,
} from 'react-icons/lu';

export const SIDE_MENU_DATA = [
  {
    id: "01",
    label: "Dashboard",
    icon: LuLayoutDashboard,
    path: "/admin/dashboard",
  },
  {
    id: "02",
    label: "Manage Tasks",
    icon: LuClipboardCheck,
    path: "/admin/tasks",
  },
  {
    id: "03",
    label: "Create Task",
    icon: LuSquarePlus,
    path: "/admin/create-task",
  },
  {
    id: "04",
    label: "Calendar",
    icon: LuCalendarDays,
    path: "/calendar",
  },
  {
    id: "05",
    label: "Analytics",
    icon: LuChartColumnBig,
    path: "/analytics",
  },
  {
    id: "06a",
    label: "Sales",
    icon: LuTrendingUp,
    path: "/sales",
    module: "sales",
  },
  {
    id: "06b",
    label: "Leads",
    icon: LuContact,
    path: "/sales/leads",
    module: "leads",
  },
  {
    id: "06",
    label: "Team Members",
    icon: LuUsers,
    path: "/admin/users"
  },
  {
    id: "07",
    label: "Departments",
    icon: LuBuilding2,
    path: "/admin/departments"
  },
  {
    id: "08",
    label: "My Profile",
    icon: LuSmartphone,
    path: "/profile",
  },
  {
    id: "09",
    label: "Log Out",
    icon: LuLogOut,
    path: "logout",
  }
];

// Heads get the same screens as an admin, minus anything org-wide: the API
// scopes every one of these to their own department.
export const SIDE_MENU_HEAD_DATA = [
  { id: "01", label: "Dashboard", icon: LuLayoutDashboard, path: "/head/dashboard" },
  { id: "02", label: "Manage Tasks", icon: LuClipboardCheck, path: "/head/tasks" },
  { id: "03", label: "Create Task", icon: LuSquarePlus, path: "/head/create-task" },
  { id: "04", label: "Calendar", icon: LuCalendarDays, path: "/calendar" },
  { id: "05", label: "Analytics", icon: LuChartColumnBig, path: "/analytics" },
  { id: "05a", label: "Sales", icon: LuTrendingUp, path: "/sales", module: "sales" },
  { id: "05b", label: "Leads", icon: LuContact, path: "/sales/leads", module: "leads" },
  { id: "06", label: "My Department", icon: LuUsers, path: "/head/users" },
  { id: "07", label: "My Profile", icon: LuSmartphone, path: "/profile" },
  { id: "08", label: "Log Out", icon: LuLogOut, path: "logout" },
];

export const SIDE_MENU_USER_DATA = [
  {
    id: "01",
    label: "Dashboard",
    icon: LuLayoutDashboard,
    path: "/user/dashboard",
  },
  {
    id: "02",
    label: "My Tasks",
    icon: LuClipboardCheck,
    path: "/user/tasks",
  },
  {
    id: "03",
    label: "Calendar",
    icon: LuCalendarDays,
    path: "/calendar",
  },
  {
    id: "04",
    label: "Analytics",
    icon: LuChartColumnBig,
    path: "/analytics",
  },
  {
    id: "04a",
    label: "Sales",
    icon: LuTrendingUp,
    path: "/sales",
    module: "sales",
  },
  {
    id: "04b",
    label: "Leads",
    icon: LuContact,
    path: "/sales/leads",
    module: "leads",
  },
  {
    id: "05",
    label: "My Profile",
    icon: LuSmartphone,
    path: "/profile",
  },
  {
    id: "06",
    label: "Logout",
    icon: LuLogOut,
    path: "logout",
  }
];

export const PRIORITY_DATA = [
  { label: "Low", value: "Low" },
  { label: "Medium", value: "Medium" },
  { label: "High", value: "High" }
];

export const STATUS_DATA = [
  { label: "Pending", value: "Pending" },
  { label: "In Progress", value: "In Progress" },
  { label: "Completed", value: "Completed" }
];

// Starting points only - the category field is a free string, and the
// /api/tasks/categories endpoint returns whatever is actually in use.
export const CATEGORY_DATA = [
  { label: "General", value: "General" },
  { label: "Design", value: "Design" },
  { label: "Development", value: "Development" },
  { label: "Marketing", value: "Marketing" },
  { label: "Research", value: "Research" },
  { label: "Operations", value: "Operations" },
  { label: "Support", value: "Support" },
];

export const SORT_OPTIONS = [
  { label: "Newest first", value: "createdAt:desc" },
  { label: "Oldest first", value: "createdAt:asc" },
  { label: "Due date (soonest)", value: "dueDate:asc" },
  { label: "Due date (latest)", value: "dueDate:desc" },
  { label: "Priority (high to low)", value: "priority:desc" },
  { label: "Progress (least done)", value: "progress:asc" },
  { label: "Title (A-Z)", value: "title:asc" },
];

// Hues live in index.css (--cat-N) so each theme can set its own.
export const CATEGORY_COLORS = [
  "text-(--cat-1) bg-(--cat-1)/10 border-(--cat-1)/25",
  "text-(--cat-2) bg-(--cat-2)/10 border-(--cat-2)/25",
  "text-(--cat-3) bg-(--cat-3)/10 border-(--cat-3)/25",
  "text-(--cat-4) bg-(--cat-4)/10 border-(--cat-4)/25",
  "text-(--cat-5) bg-(--cat-5)/10 border-(--cat-5)/25",
  "text-(--cat-6) bg-(--cat-6)/10 border-(--cat-6)/25",
];

// Stable colour per category name without keeping a colour map in sync.
export const categoryColor = (name = "") => {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
};

/**
 * One source of truth for what a status or priority looks like. Four
 * components used to each carry their own switch, and they had already drifted
 * apart - "Pending" was violet in one place and indigo in another.
 */
export const statusChip = (status) => ({
  "In Progress": "chip-active",
  Completed: "chip-done",
  Pending: "chip-pending",
}[status] || "chip-mist");

export const priorityChip = (priority) => ({
  High: "chip-alert",
  Medium: "chip-signal",
  Low: "chip-done",
}[priority] || "chip-mist");

/** Bar and dot fills, for places a chip would be too heavy. */
export const statusFill = (status) => ({
  "In Progress": "bg-active",
  Completed: "bg-done",
  Pending: "bg-pending",
}[status] || "bg-mist");

/** Matching text colour, for anything that glows in its own hue (currentColor). */
export const statusText = (status) => ({
  "In Progress": "text-active",
  Completed: "text-done",
  Pending: "text-pending",
}[status] || "text-mist");

export const priorityFill = (priority) => ({
  High: "bg-alert",
  Medium: "bg-signal",
  Low: "bg-done",
}[priority] || "bg-mist");

/**
 * Chart series colours. Deliberately deeper steps than the UI chips: these are
 * selected for the dark chart surface (#0e1524), not flipped from the light
 * ones. Both sets are validated - status passes every check outright
 * (worst adjacent CVD dE 13.7); priority sits in the 6-8 CVD floor band at 7.9,
 * which holds because every bar is labelled on the x-axis.
 */
export const STATUS_CHART_COLORS = ["#8b5cf6", "#0369a1", "#059669"];
export const PRIORITY_CHART_COLORS = { Low: "#059669", Medium: "#d97706", High: "#e11d48" };

/** Chart chrome, so axes and grids stay recessive against the panel. */
export const CHART_INK = {
  // CSS variables, so the charts follow the light/dark theme.
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  label: "var(--color-mist)",
};
