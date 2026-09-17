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
import Leads from './pages/Sales/Leads';
import LeadDetail from './pages/Sales/LeadDetail';
import SalesDashboard from './pages/Sales/SalesDashboard';
import Analytics from './pages/Analytics';
import Profile from './pages/Profile';
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
                <Route path="/profile" element={<Profile />} />
              </Route>

              {/* Sales and Leads are granted per department (Department.modules).
                  This guard is UX only - requireModule on the API enforces it. */}
              <Route element={<PrivateRoute requiresModule="sales" />}>
                <Route path="/sales" element={<SalesDashboard />} />
              </Route>
              <Route element={<PrivateRoute requiresModule="leads" />}>
                <Route path="/sales/leads" element={<Leads />} />
                <Route path="/sales/leads/:id" element={<LeadDetail />} />
              </Route>

              {/* default path */}
              <Route path='/' element={<Root />} />
            </Routes>
          </Router>
        </div>
        <Toaster
          position="bottom-right"
          toastOptions={{
            // Toasts are glass panels too, so a confirmation never looks like it
            // came from a different application.
            style: {
              fontSize: '13px',
              background: 'rgba(14, 21, 36, 0.86)',
              color: '#eaf1ff',
              border: '1px solid rgba(148, 178, 255, 0.14)',
              backdropFilter: 'blur(20px) saturate(140%)',
              boxShadow: '0 20px 45px -25px rgba(0,0,0,0.95)',
              borderRadius: '12px',
            },
            success: { iconTheme: { primary: '#34d399', secondary: '#070a12' } },
            error: { iconTheme: { primary: '#fb7185', secondary: '#070a12' } },
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
