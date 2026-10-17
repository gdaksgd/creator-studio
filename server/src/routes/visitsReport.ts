import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const router = Router();
const reportsDir = path.join(config.dataDir, 'reports');

/**
 * 私密访问日报：/r/<REPORT_TOKEN>/visits-YYYY-MM-DD.html
 * - token 来自 server/.env 的 REPORT_TOKEN（为空则整条路由 404）；
 * - 文件名做白名单校验，只允许 reports/ 下的日期命名的日报；
 * - 报表含访客 IP，禁止搜索引擎索引、禁止缓存。
 */
router.get('/r/:token/:file', (req, res) => {
  const expected = config.reportToken;
  const { token, file } = req.params;
  if (!expected || token !== expected) {
    res.status(404).end();
    return;
  }
  if (!/^visits-\d{4}-\d{2}-\d{2}\.html$/.test(file)) {
    res.status(404).end();
    return;
  }
  const full = path.join(reportsDir, file);
  if (!full.startsWith(reportsDir + path.sep) || !fs.existsSync(full)) {
    res.status(404).end();
    return;
  }
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html');
  fs.createReadStream(full).pipe(res);
});

export default router;
