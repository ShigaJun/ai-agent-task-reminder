import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import { config } from '../src/config';

/**
 * 診断用: Botがアクセスできるサーバーとチャンネルを一覧表示する
 * 実行: npx ts-node scripts/diagnose-access.ts
 */
async function main(): Promise<void> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user?.tag}`);
    console.log(`Times channel prefix: ${config.discord.timesChannelPrefix}`);
    console.log('--- Accessible Guilds (Botが参加しているサーバー) ---');

    const guilds = client.guilds.cache;
    if (guilds.size === 0) {
      console.log('(Botが参加しているサーバーがありません)');
    }
    for (const guild of guilds.values()) {
      console.log(`- ${guild.name} (ID: ${guild.id})`);
      try {
        const channels = await guild.channels.fetch();
        for (const ch of channels.values()) {
          if (ch && 'name' in ch) {
            const mark = (ch as any).name.startsWith(config.discord.timesChannelPrefix)
              ? '  <=== timesチャンネル'
              : '';
            console.log(`    #${(ch as any).name} (ID: ${ch.id})${mark}`);
          }
        }
      } catch (e) {
        console.log(`    (チャンネル取得エラー: ${e})`);
      }
    }

    await client.destroy();
    process.exit(0);
  });

  await client.login(config.discord.botToken);
}

main().catch((error) => {
  console.error('Diagnosis failed:', error);
  process.exit(1);
});
