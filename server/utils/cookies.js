const AUTH_COOKIE = 'tm_token';
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // matches the JWT's 2d expiry

const readCookie = (req, name) => {
    const match = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
};

// Secure is opt-in (COOKIE_SECURE=true): a deployment still on plain http would
// otherwise have the browser silently drop the cookie and nobody could log in.
const cookieOptions = () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
});

const setAuthCookie = (res, token) => res.cookie(AUTH_COOKIE, token, { ...cookieOptions(), maxAge: MAX_AGE_MS });
const clearAuthCookie = (res) => res.clearCookie(AUTH_COOKIE, cookieOptions());

module.exports = { AUTH_COOKIE, readCookie, setAuthCookie, clearAuthCookie };
