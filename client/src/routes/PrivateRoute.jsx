import React, { useContext } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { UserContext } from '../context/userContext';
import { homeFor, hasModule } from '../utils/roles';



/**
 * Route guard. `allowedRoles` omitted means "any signed-in user";
 * `requiresModule` gates on a module the user's departments grant.
 * This is a UX guard only - the API is what actually enforces access.
 */
const PrivateRoute = ({ allowedRoles, requiresModule }) => {
  const { user, loading } = useContext(UserContext);

  // The profile fetch is still in flight. Deciding now would bounce a
  // signed-in user to /login on every page refresh.
  if (loading) {
    return (
      <div className="grid place-items-center h-dvh" role="status" aria-label="Loading">
        {/* The same lit aperture as the navbar mark, breathing. */}
        <span className="relative grid place-items-center w-14 h-14 rounded-2xl panel">
          <span className="w-3 h-3 rounded-full bg-signal animate-pulse shadow-[0_0_20px_4px_rgba(255,176,32,0.6)]" />
        </span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Wrong role: send them to their own dashboard, never to /login - that
  // would look like a failed session and invites a redirect loop.
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={homeFor(user)} replace />;
  }

  // Same treatment as a wrong role: a bookmarked /sales for someone whose
  // department does not grant it behaves like any other unauthorised URL.
  // UX only - requireModule on the server is what enforces this.
  if (requiresModule && !hasModule(user, requiresModule)) {
    return <Navigate to={homeFor(user)} replace />;
  }

  return <Outlet />;
};

export default PrivateRoute;
