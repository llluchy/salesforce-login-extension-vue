-- ============================================================
-- 分享记录过期自动清理
-- ============================================================
-- 作用：
--   定期清理 env_shares 表中「已过期」且「创建超过 30 天」且「未使用」的分享记录，
--   防止分享数据无限累积，控制表体积。
--
-- 清理条件（AND 关系，三者需同时满足）：
--   1. expires_at < NOW()                             -- 已过期
--   2. created_at < NOW() - INTERVAL '30 days'        -- 创建超过 30 天
--   3. status != 'used'                               -- 未使用（已使用的保留追溯）
--
-- 说明：
--   - 通过子查询 + LIMIT 10000 分批删除，避免单次事务锁定过多行。
--   - 已使用（status='used'）的记录保留，用于审计/追溯，不参与清理。
--
-- 定时周期：
--   已在 Supabase 控制台通过 pg_cron 配置，每天定时执行一次。
--   可在控制台 SQL Editor 中用以下语句查看/管理任务：
--     select * from cron.job;                          -- 查看定时任务
--     select cron.unschedule('<任务名>');              -- 停止某个任务
-- ============================================================

DELETE FROM env_shares
WHERE id IN (
  SELECT id FROM env_shares
  WHERE expires_at < NOW()                               -- 已过期
    AND (created_at IS NULL OR created_at < NOW() - INTERVAL '30 days')  -- 创建超过 30 天
    AND status != 'used'                                 -- 未使用（已使用的保留追溯）
  LIMIT 10000
);