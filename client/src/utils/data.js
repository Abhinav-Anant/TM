import {
  LuLayoutDashboard, LuClipboardCheck, LuSquarePlus, LuLogOut, LuUsers,
  LuCalendarDays, LuChartColumnBig,
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
    id: "06",
    label: "Team Members",
    icon: LuUsers,
    path: "/admin/users"
  },
  {
    id: "07",
    label: "Log Out",
    icon: LuLogOut,
    path: "logout",
  }
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
    id: "05",
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

export const CATEGORY_COLORS = [
  "bg-blue-50 text-blue-600 border-blue-200",
  "bg-purple-50 text-purple-600 border-purple-200",
  "bg-teal-50 text-teal-600 border-teal-200",
  "bg-orange-50 text-orange-600 border-orange-200",
  "bg-pink-50 text-pink-600 border-pink-200",
  "bg-indigo-50 text-indigo-600 border-indigo-200",
];

// Stable colour per category name without keeping a colour map in sync.
export const categoryColor = (name = "") => {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
};
