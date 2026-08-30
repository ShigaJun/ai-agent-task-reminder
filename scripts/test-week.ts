import 'dotenv/config';
import { EsaClient } from '../src/mcp/esa-client';
import { MarkdownParser } from '../src/utils/markdown-parser';

(async () => {
  const client = new EsaClient();

  console.log('=== wata_haru (期待: 週報/2026/36/wata_haru) ===');
  const r1 = await client.getWeeklyReport(undefined, undefined, 'wata_haru');
  console.log('result:', r1 ? r1.fullName : 'null');
  if (r1) {
    const tasks = MarkdownParser.extractTasks(r1.bodyMarkdown);
    console.log('extracted tasks:', JSON.stringify(tasks, null, 2));
  }

  console.log('=== zakiyoshi (期待: null / チーム最新週36の週報なし) ===');
  const r2 = await client.getWeeklyReport(undefined, undefined, 'zakiyoshi');
  console.log('result:', r2 ? r2.fullName : 'null');

  console.log('=== zingu (期待: 週報/2026/36/zingu) ===');
  const r3 = await client.getWeeklyReport(undefined, undefined, 'zingu');
  console.log('result:', r3 ? r3.fullName : 'null');

  console.log('=== 週番号明示指定 35/wata_haru (期待: 週報/2026/35/wata_haru) ===');
  const r4 = await client.getWeeklyReport(undefined, 35, 'wata_haru');
  console.log('result:', r4 ? r4.fullName : 'null');

  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
