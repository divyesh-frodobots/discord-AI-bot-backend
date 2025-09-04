/**
 * Authentication middleware factory for the Channel Manager API.
 * Validates simple admin credentials provided in request body.
 */
export default function createAuthenticateUser({ adminId, adminPassword }) {
  const expectedId = adminId || process.env.ADMIN_ID || 'admin';
  const expectedPassword = adminPassword || process.env.ADMIN_PASSWORD || 'password123';

  return function authenticateUser(req, res, next) {
    try {
      const { adminId: providedId, adminPassword: providedPassword } = req.body || {};
      if (providedId === expectedId && providedPassword === expectedPassword) {
        return next();
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    } catch (error) {
      return res.status(401).json({ error: 'Authentication failed' });
    }
  };
}


