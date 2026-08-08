import { Router } from 'express';
import { config } from '../config.js';

const router = Router();

// Verify password
router.post('/check', (req, res) => {
  const { password } = req.body;

  // If no password configured (local dev), always allow
  if (!config.authPassword) {
    return res.json({ success: true, configured: false });
  }

  if (password === config.authPassword) {
    return res.json({ success: true, configured: true });
  }

  res.status(401).json({ success: false, configured: true, error: '密码错误' });
});

export default router;
