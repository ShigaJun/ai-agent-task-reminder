import { TaskDbClient } from '../src/mcp/task-db';

async function main(): Promise<void> {
  if (!process.argv.includes('--yes')) {
    console.error('データベースを初期化するには `npm run reset-db -- --yes` を実行してください。');
    process.exitCode = 1;
    return;
  }

  const taskDb = new TaskDbClient();
  try {
    await taskDb.initialize();
    await taskDb.resetTaskData();
    console.log('タスク・進捗履歴・リマインド履歴を初期化しました（ユーザー登録は保持）。');
  } finally {
    await taskDb.close();
  }
}

void main().catch((error) => {
  console.error('データベースの初期化に失敗しました:', error);
  process.exitCode = 1;
});
