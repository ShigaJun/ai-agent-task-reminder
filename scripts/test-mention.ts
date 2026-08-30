import 'dotenv/config';
import { DiscordClient } from '../src/mcp/discord-client';
import { TaskDbClient } from '../src/mcp/task-db';
import { EsaClient } from '../src/mcp/esa-client';
import { TaskManager } from '../src/skills/task-manager';
import { SchedulerHook } from '../src/hooks/scheduler';
import { MentionHandlerHook } from '../src/hooks/mention-handler';

/**
 * テスト用: メンションハンドラのコマンド分岐を擬似メッセージで検証する
 * 実行: npx ts-node scripts/test-mention.ts
 * ※ 検証用のメッセージが実際にtimesチャンネルへ投稿される
 */
async function main(): Promise<void> {
  const taskDb = new TaskDbClient();
  await taskDb.initialize();

  const discordClient = new DiscordClient();
  await discordClient.connect();
  await discordClient.refreshTimesChannelCache();

  const botId = discordClient.getBotId();
  if (!botId) {
    throw new Error('Bot ID unavailable');
  }
  console.log(`Bot ID: ${botId}`);

  const taskManager = new TaskManager(taskDb, new EsaClient());
  const schedulerHook = new SchedulerHook(taskDb, discordClient, taskManager);
  const hook = new MentionHandlerHook(discordClient, taskDb, schedulerHook);

  const channel = await discordClient.resolveChannelByName('times-wata_haru');
  if (!channel) {
    throw new Error('Channel not found: times-wata_haru');
  }

  const fake = (content: string): any => ({
    id: `test-${Date.now()}-${Math.random()}`,
    content,
    author: { id: 'human-user', username: 'tester' },
    channelId: channel.id,
    channelName: 'times-wata_haru',
    timestamp: Date.now().toString(),
  });

  console.log('=== 1. @リマインダーbot 達成度チェック（名前指定テキスト） ===');
  await (hook as any).handleMessage(fake('@リマインダーbot 達成度チェック'));

  console.log('=== 2. @リマインダーbot 来週やること ===');
  await (hook as any).handleMessage(fake('@リマインダーbot 来週やること'));

  console.log('=== 3. @リマインダーbot その他（ヘルプ表示） ===');
  await (hook as any).handleMessage(fake('@リマインダーbot こんにちは'));

  console.log('=== 4. 非トリガー（何も起きないはず） ===');
  await (hook as any).handleMessage(fake('普通のメッセージ'));

  await discordClient.disconnect();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
