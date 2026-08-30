import { DiscordClient } from '../src/mcp/discord-client';

/**
 * テスト用: 指定したtimesチャンネルに通知を1回だけ送信する
 * 実行: npx ts-node scripts/test-notification.ts [チャンネル名(省略時は全て)]
 */
async function main(): Promise<void> {
  const client = new DiscordClient();
  await client.connect();
  // timesチャンネルのキャッシュを読み込んでから解決・送信する
  await client.refreshTimesChannelCache();

  const targetName = process.argv[2];

  const testMessage = [
    '🧪 **テスト通知です**',
    'AIエージェントタスク管理・リマインドシステムの動作確認用メッセージです。',
    '正常に受信できていれば、Discord Botの接続は成功しています！',
  ].join('\n');

  if (targetName) {
    console.log(`Connected. Sending test message to "${targetName}"...`);
    await client.sendToTimesChannelByName(targetName, testMessage);
    console.log(`Test message sent to "${targetName}" successfully.`);
    await client.disconnect();
    // stdoutのフラッシュを待ってから終了
    await new Promise((r) => setTimeout(r, 300));
    process.exit(0);
  } else {
    console.log('Connected. Sending test message to all times channels...');
    const channels = await client.getTimesChannels();
    if (channels.length === 0) {
      console.log('No times channels found.');
      process.exit(1);
    }
    for (const channel of channels) {
      await channel.send(testMessage);
      console.log(`Sent to #${channel.name}`);
    }
    await client.disconnect();
    await new Promise((r) => setTimeout(r, 300));
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Test notification failed:', error);
  process.exit(1);
});
