import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { startScheduler } from './services/scheduler.js';
import { authMiddleware } from './middleware/auth.js';
import newsRoutes from './routes/news.js';
import aiRoutes from './routes/ai.js';
import syncRoutes from './routes/sync.js';
import authRoutes from './routes/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check (public, no auth needed)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Auth check route (public, no auth needed)
app.use('/api/auth', authRoutes);

// Auth middleware for all other /api routes
app.use('/api', authMiddleware);

// Routes
app.use('/api/news', newsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/sync', syncRoutes);

// Serve frontend static files (production mode)
const frontendDist = path.join(__dirname, '..', 'public');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // SPA fallback: all non-API routes serve index.html
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(frontendDist, 'index.html'));
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });
}

app.listen(config.port, () => {
  console.log(`\n=================================`);
  console.log(`  Creator Studio Server`);
  console.log(`  Running on http://localhost:${config.port}`);
  console.log(`=================================\n`);
  console.log(`AI: ${config.deepseekApiKey ? 'Configured' : 'Not configured (set DEEPSEEK_API_KEY in .env)'}`);
  console.log(`YouTube: ${config.youtubeApiKey ? 'Configured' : 'Not configured (set YOUTUBE_API_KEY in .env)'}`);
  console.log(`Supabase: ${config.supabaseUrl ? 'Configured' : 'Not configured (set SUPABASE_URL in .env)'}`);
  console.log(`Auth: ${config.authPassword ? 'Enabled' : 'Disabled (set AUTH_PASSWORD in .env)'}`);
  console.log(`Frontend: ${fs.existsSync(frontendDist) ? 'Serving from /public' : 'Not built (run frontend build first)'}`);
  console.log('');

  // Start scheduled collection
  startScheduler();

  // Initial collection on startup (delayed)
  setTimeout(() => {
    import('./services/scheduler.js').then(({ collectAll }) => {
      collectAll().catch(console.error);
    });
  }, 3000);
});
