import React, { useContext, useState } from 'react';
import AuthLayout from '../../components/layouts/AuthLayout';
import { Link, useNavigate } from 'react-router-dom';
import Input from '../../customcomponent/Input';
import ProfilePhotoSelector from '../../customcomponent/ProfilePhotoSelector';
import { UserContext } from '../../context/userContext';
import { homeFor } from '../../utils/roles';
import axiosInstance from "../../utils/axiosInstance";
import uploadImage from '../../utils/uploadImage';
import { API_PATHS } from '../../utils/apiPaths';

const SignUp = () => {
  const [profilePic, setProfilePic] = useState(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminInviteToken, setAdminInviteToken] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { updatedUser } = useContext(UserContext);
  const navigate = useNavigate();

  const handleSignUp = async (e) => {
    e.preventDefault();


    if (!fullName) {
      setError("Enter your full name.");
      return;
    }
    if (!email) {
      setError("Enter your email address.");
      return;
    }
    if (!password) {
      setError("Choose a password.");
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
      const response = await axiosInstance.post(API_PATHS.AUTH.REGISTER, {
        name: fullName,
        email,
        password,
        adminInviteToken
      });
      let account = response.data;

      // Uploads need a session, so the photo goes up after the account exists.
      if (profilePic) {
        try {
          const { imageUrl } = await uploadImage(profilePic);
          const updated = await axiosInstance.put(API_PATHS.AUTH.UPDATE_PROFILE, { profileImageUrl: imageUrl });
          account = updated.data;
        } catch {
          /* the account is fine; they can add a photo from Profile */
        }
      }

      updatedUser(account);
      navigate(homeFor({ role: account.role }));
    } catch (error) {
      if (error.response && error.response.data.message) {
        setError(error.response.data.message)
      } else {
        console.error("Registration failed:", error);
        setError("Could not reach the server. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <div className="w-full max-w-lg">
        <h2 className="font-display text-3xl text-beam">Create your account</h2>
        <p className="text-sm text-mist mt-2 mb-8">
          You will land on your own dashboard as soon as this is done.
        </p>

        <form onSubmit={handleSignUp} noValidate>
          <ProfilePhotoSelector image={profilePic} setImage={setProfilePic} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
            <Input
              value={fullName}
              onChange={({ target }) => setFullName(target.value)}
              label="Full name"
              placeholder="Jordan Mehta"
              type="text"
            />
            <Input
              label="Email address"
              value={email}
              onChange={({ target }) => setEmail(target.value)}
              placeholder="you@company.com"
              type="email"
            />
            <Input
              label="Password"
              value={password}
              onChange={({ target }) => setPassword(target.value)}
              placeholder="At least 8 characters"
              type="password"
            />
            <Input
              label="Admin invite code"
              value={adminInviteToken}
              onChange={({ target }) => setAdminInviteToken(target.value)}
              placeholder="Leave blank to join as a member"
              type="text"
            />
          </div>

          {error && (
            <p role="alert" className="chip chip-alert w-full justify-start mb-4">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
            {submitting ? 'Creating account' : 'Create account'}
          </button>

          <p className="text-sm text-mist mt-6">
            Already have an account?{' '}
            <Link className="text-signal hover:underline underline-offset-4" to="/login">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </AuthLayout>
  );
};

export default SignUp;
