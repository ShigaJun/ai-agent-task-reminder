import 'dotenv/config';
import { TaskDbClient } from '../src/mcp/task-db';
import { EsaClient } from '../src/mcp/esa-client';
import { TaskManager } from '../src/skills/task-manager';

/**
 * esaの週報（最新週）からDBのタスクを手動同期する
 * ※ Discordへの投稿は行わない（DBの更新のみ）
 * 実行: npm run sync-tasks
 *
 * - 同一テキストのタスクは重複登録されず既存行を更新する（upsert）
 * - 週報で「完了」になっていれば完了に更新するが、
 *   手動で完了にしたタスクが未完了に戻されることはない
 */
async function main(): Promise<void> {
  console.log('Syncing tasks from esa...');

  const taskDb = new TaskDbClient();
  await taskDb.initialize();

  const taskManager = new TaskManager(taskDb, new EsaClient());

  const users = await taskDb.getAllUsers();
  if (users.length === 0) {
    console.log('No users found.');
    await taskDb.close();
    process.exit(0);
  }

  for (const user of users) {
    try {
      const tasks = await taskManager.fetchAndSaveWeeklyTasks(user.id);
      console.log(
        tasks.length > 0
          ? `Synced ${tasks.length} tasks for ${user.discord_times_channel_name}.`
          : `No weekly report found for ${user.discord_times_channel_name}. Skipped.`
      );
    } catch (error) {
      console.error(`Sync failed for ${user.discord_times_channel_name}:`, error);
    }
  }

  await taskDb.close();
  console.log('Sync completed.');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
