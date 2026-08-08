-- ============================================
-- Creator Studio - Supabase 建表脚本
-- 在 Supabase Dashboard > SQL Editor 中执行
-- ============================================

-- 云同步数据表（单行设计，存储所有选题和脚本数据）
CREATE TABLE IF NOT EXISTS app_sync (
  id INTEGER PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded_at BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT single_row CHECK (id = 1)
);

-- 插入初始空行
INSERT INTO app_sync (id, data, uploaded_at)
VALUES (1, '{"topics":[],"scripts":[]}'::jsonb, 0)
ON CONFLICT (id) DO NOTHING;

-- 启用 Row Level Security
ALTER TABLE app_sync ENABLE ROW LEVEL SECURITY;

-- 创建策略：允许 anon 角色读写（因为使用 anon key）
-- 注意：安全性由应用层的密码认证保障
CREATE POLICY "Allow anon read" ON app_sync
  FOR SELECT TO anon USING (true);

CREATE POLICY "Allow anon write" ON app_sync
  FOR ALL TO anon USING (true) WITH CHECK (true);
