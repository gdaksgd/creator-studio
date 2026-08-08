import { Router } from 'express';
import { supabase, isSupabaseConfigured, SYNC_TABLE } from '../services/supabaseClient.js';

const router = Router();

// Upload sync data (topics + scripts)
router.post('/upload', async (req, res) => {
  try {
    if (!isSupabaseConfigured() || !supabase) {
      return res.status(503).json({ error: '云端同步未配置' });
    }

    const { topics, scripts, uploadedAt } = req.body;

    if (!Array.isArray(topics) || !Array.isArray(scripts)) {
      return res.status(400).json({ error: '数据格式错误' });
    }

    const { error } = await supabase
      .from(SYNC_TABLE)
      .upsert({
        id: 1,
        data: { topics, scripts },
        uploaded_at: uploadedAt || Date.now(),
      });

    if (error) {
      console.error('Sync upload error:', error);
      return res.status(500).json({ error: '同步失败: ' + error.message });
    }

    res.json({ success: true, uploadedAt: uploadedAt || Date.now() });
  } catch (err) {
    console.error('Sync upload error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// Download sync data
router.get('/download', async (req, res) => {
  try {
    if (!isSupabaseConfigured() || !supabase) {
      return res.json({ topics: [], scripts: [], uploadedAt: 0 });
    }

    const { data, error } = await supabase
      .from(SYNC_TABLE)
      .select('data, uploaded_at')
      .eq('id', 1)
      .single();

    if (error || !data) {
      // No data yet, return empty
      return res.json({ topics: [], scripts: [], uploadedAt: 0 });
    }

    const syncData = data.data as { topics: any[]; scripts: any[] };
    res.json({
      topics: syncData.topics || [],
      scripts: syncData.scripts || [],
      uploadedAt: data.uploaded_at || 0,
    });
  } catch (err) {
    console.error('Sync download error:', err);
    res.json({ topics: [], scripts: [], uploadedAt: 0 });
  }
});

// Check if sync is configured
router.get('/status', (req, res) => {
  res.json({
    syncConfigured: isSupabaseConfigured(),
  });
});

export default router;
