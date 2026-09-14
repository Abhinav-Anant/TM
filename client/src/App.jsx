import React, { useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Outlet, Navigate } from 'react-router-dom';
import Login from './pages/Auth/Login';
import SignUp from './pages/Auth/SignUp';
import PrivateRoute from './routes/PrivateRoute';
import DashBoard from './pages/Admin/Dashboard';
import ManageTasks from './pages/Admin/ManageTasks';
import CreateTask from './pages/Admin/CreateTask';
import ManageUsers from './pages/Admin/ManageUsers';
import ManageDepartments from './pages/Admin/ManageDepartments';
import UserDashboard from './pages/User/UserDashboard';
import MyTasks from './pages/User/MyTasks';
import ViewTaskDetails from './pages/User/ViewTaskDetails';
import CalendarView from './pages/CalendarView';
import Analytics from './pages/Analytics';
import UserProvider, { UserContext } from './context/userContext';
import { homeFor } from './utils/roles';
import NotificationProvider from './context/notificationContext';
import { Toaster } from 'react-hot-toast';

const App = () => {
  return (
    <UserProvider>
      <NotificationProvider>
        <div>
          <Router>
            <Routes>
              {/* Public Routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<SignUp />} />

              {/* Admin Routes (Protected) */}
              <Route element={<PrivateRoute allowedRoles={['admin']} />}>
                <Route path="/admin/dashboard" element={<DashBoard />} />
                <Route path="/admin/tasks" element={<ManageTasks />} />
                <Route path="/admin/create-task" element={<CreateTask />} />
                <Route path="/admin/users" element={<ManageUsers />} />
                <Route path="/admin/departments" element={<ManageDepartments />} />
              </Route>

              {/* Head of Department Routes (Protected).
                  Same screens as admin - the API scopes every response to the
                  head's own department. */}
              <Route element={<PrivateRoute allowedRoles={['head']} />}>
                <Route path="/head/dashboard" element={<DashBoard />} />
                <Route path="/head/tasks" element={<ManageTasks />} />
                <Route path="/head/create-task" element={<CreateTask />} />
                <Route path="/head/users" element={<ManageUsers />} />
              </Route>

              {/* Member Routes (Protected) - "member" is the role the API issues */}
              <Route element={<PrivateRoute allowedRoles={['member']} />}>
                <Route path="/user/dashboard" element={<UserDashboard />} />
                <Route path="/user/tasks" element={<MyTasks />} />
              </Route>

              {/* Any signed-in user - the API scopes the data by role.
                  Task details stays open to both: notifications and analytics link here. */}
              <Route element={<PrivateRoute />}>
                <Route path="/user/task-details/:id" element={<ViewTaskDetails />} />
                <Route path="/calendar" element={<CalendarView />} />
                <Route path="/analytics" element={<Analytics />} />
              </Route>

              {/* default path */}
              <Route path='/' element={<Root />} />
            </Routes>
          </Router>
        </div>
        <Toaster
          toastOptions={{
            className: "",
            style: {
              fontSize: "13px",
            }
          }}
        />
      </NotificationProvider>
    </UserProvider>

  );
};

export default App;



const Root = () => {
  const { user, loading } = useContext(UserContext)
  if (loading) return <Outlet />;
  if (!user) {
    return <Navigate to="/login" />
  }

  return <Navigate to={homeFor(user)} />


}
