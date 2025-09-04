import express from 'express';

export default function createAuthRouter(authenticateUser) {
  const router = express.Router();

  // Login simply validates credentials via middleware
  router.post('/login', authenticateUser, (req, res) => {
    res.json({ success: true });
  });

  return router;
}


