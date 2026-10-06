const AUTH_COOKIE = 'tm_token';
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // matches the JWT's 2d expiry

const readCookie = (req, name) => {
    const match = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
};

// Secure is opt-in (COOKIE_SECURE=true): a deployment still on plain http would
// otherwise have the browser silently drop the cookie and nobody could log in.
// Even then it applies only to requests that arrived over HTTPS, so the same server
// can also answer on plain http (e.g. by IP address when DNS is broken) and still log in.
// req.secure reads X-Forwarded-Proto from the local nginx (trust proxy: loopback).
const cookieOptions = (req) => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true' && Boolean(req?.secure),
    path: '/',
});

const setAuthCookie = (res, token) => res.cookie(AUTH_COOKIE, token, { ...cookieOptions(res.req), maxAge: MAX_AGE_MS });
const clearAuthCookie = (res) => res.clearCookie(AUTH_COOKIE, cookieOptions(res.req));

module.exports = { AUTH_COOKIE, readCookie, setAuthCookie, clearAuthCookie };
