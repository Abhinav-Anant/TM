/**
 * Where each role lives in the URL space. Heads get their own /head/* section
 * that reuses the admin screens - the API scopes the data to their department.
 */
export const basePathFor = (user) => {
  if (user?.role === 'admin') return '/admin';
  if (user?.role === 'head') return '/head';
  return '/user';
};

export const homeFor = (user) => `${basePathFor(user)}/dashboard`;

/** Roles that may create and assign tasks. */
export const canAssignTasks = (user) => user?.role === 'admin' || user?.role === 'head';

/**
 * Which screens this user's departments grant. The server computes it and
 * sends it on the profile, so the rule has exactly one implementation.
 */
export const hasModule = (user, name) => (user?.modules || []).includes(name);
