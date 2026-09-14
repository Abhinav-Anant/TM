import React, { useContext } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import HashLoader from 'react-spinners/HashLoader';
import { UserContext } from '../context/userContext';
import { homeFor } from '../utils/roles';



/**
 * Route guard. `allowedRoles` omitted means "any signed-in user".
 * This is a UX guard only - the API is what actually enforces access.
 */
const PrivateRoute = ({ allowedRoles }) => {
  const { user, loading } = useContext(UserContext);

  // The profile fetch is still in flight. Deciding now would bounce a
  // signed-in user to /login on every page refresh.
  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <HashLoader color="#6366F1" size={70} />
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

  return <Outlet />;
};

export default PrivateRoute;
