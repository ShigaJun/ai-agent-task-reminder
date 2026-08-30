import { DiscordClient } from '../src/mcp/discord-client';

/**
 * テスト用: 指定したtimesチャンネルの最新メッセージを取得して表示する
 * 実行: npx ts-node scripts/check-last-message.ts [チャンネル名] [取得件数]
 */
async function main(): Promise<void> {
  const channelName = process.argv[2];
  const limit = parseInt(process.argv[3] || '5', 10);

  if (!channelName) {
    console.error('Usage: npx ts-node scripts/check-last-message.ts <channel-name> [limit]');
    process.exit(1);
  }

  const client = new DiscordClient();
  await client.connect();
  await client.refreshTimesChannelCache();

  const channel = await client.resolveChannelByName(channelName);
  if (!channel) {
    console.error(`Channel not found: ${channelName}`);
    await client.disconnect();
    process.exit(1);
  }

  const messages = await channel.messages.fetch({ limit });
  const sorted = [...messages.values()].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );

  console.log(`=== #${channel.name} latest ${sorted.length} messages ===`);
  for (const msg of sorted) {
    console.log(`[${msg.author.username}]`);
    console.log(msg.content);
    // ボタン等のコンポーネント情報（API生データをそのまま出力）
    if (msg.components && msg.components.length > 0) {
      console.log('  components:', JSON.stringify(msg.components, null, 2));
    }
    console.log('---');
  }

  await client.disconnect();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
}

main().catch((error) => {
  console.error('Check failed:', error);
  process.exit(1);
});
