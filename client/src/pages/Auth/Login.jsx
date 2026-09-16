import React, { useContext, useState } from 'react'
import AuthLayout from '../../components/layouts/AuthLayout'
import { Link, useNavigate } from 'react-router-dom';
import Input from '../../customcomponent/Input';
import axiosInstance from '../../utils/axiosInstance';
import { API_PATHS } from '../../utils/apiPaths';
import { UserContext } from '../../context/userContext';
import { homeFor } from '../../utils/roles';

const Login = () => {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const { updatedUser } = useContext(UserContext)
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!email) {
      setError("Enter your email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("That email address is not valid.");
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      const response = await axiosInstance.post(API_PATHS.AUTH.LOGIN, {
        email,
        password,
      });

      const { token, role } = response.data;
      updatedUser(response.data)
      if (token) {
        localStorage.setItem("token", token);
        navigate(homeFor({ role }));
      }
    } catch (error) {
      if (error.response && error.response.data.message) {
        setError(error.response.data.message)
      } else {
        console.error("Login failed:", error);
        setError("Could not reach the server. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <div className="w-full max-w-sm">
        <h2 className="font-display text-3xl text-beam">Sign in</h2>
        <p className="text-sm text-mist mt-2 mb-8">Use the email address your team uses.</p>

        <form onSubmit={handleLogin} noValidate>
          <Input
            value={email}
            onChange={({ target }) => setEmail(target.value)}
            label="Email address"
            placeholder="you@company.com"
            type="email"
          />
          <Input
            label="Password"
            value={password}
            onChange={({ target }) => setPassword(target.value)}
            placeholder="Your password"
            type="password"
          />

          {error && (
            <p role="alert" className="chip chip-alert w-full justify-start mb-4">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
            {submitting ? 'Signing in' : 'Sign in'}
          </button>

          <p className="text-sm text-mist mt-6">
            No account yet?{' '}
            <Link className="text-signal hover:underline underline-offset-4" to="/signup">
              Create one
            </Link>
          </p>
        </form>
      </div>
    </AuthLayout>
  )
}

export default Login
