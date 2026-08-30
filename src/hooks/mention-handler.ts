import { config } from '../config';
import { DiscordClient } from '../mcp/discord-client';
import { TaskDbClient } from '../mcp/task-db';
import { DiscordMessage } from '../types';
import { SchedulerHook } from './scheduler';
import { TaskOperator } from '../skills/task-operator';
import { getJapaneseYearAndWeek } from '../utils/japanese-week';

/**
 * メンションハンドラフック
 * Botへのメンションをコマンドとして受け付け、
 * 自然言語でタスク操作を実行する
 *
 * ※ Botが起動している間のみ反応する
 *   （launchdの金曜9:00/13:00起動後30分、または手動起動中）
 */
export class MentionHandlerHook {
  private discordClient: DiscordClient;
  private taskDb: TaskDbClient;
  private schedulerHook: SchedulerHook;
  private taskOperator: TaskOperator;

  constructor(
    discordClient: DiscordClient,
    taskDb: TaskDbClient,
    schedulerHook: SchedulerHook,
    taskOperator: TaskOperator
  ) {
    this.discordClient = discordClient;
    this.taskDb = taskDb;
    this.schedulerHook = schedulerHook;
    this.taskOperator = taskOperator;
  }

  /**
   * メンション監視を開始
   */
  start(): void {
    this.discordClient.onMessage(async (message) => {
      await this.handleMessage(message);
    });
    console.log('Mention handler started.');
  }

  /**
   * メンションメッセージを処理する
   * - timesチャンネル内: そのユーザーに対してコマンドを実行
   * - それ以外: timesチャンネルで使うよう案内
   */
  private async handleMessage(message: DiscordMessage): Promise<void> {
    try {
      if (!this.discordClient.isMentioningMe(message.content)) {
        return;
      }

      console.log(
        `[mention] ${message.channelName ?? message.channelId}: "${message.content.slice(0, 50)}"`
      );

      if (
        !message.channelName ||
        !message.channelName.startsWith(config.discord.timesChannelPrefix)
      ) {
        await this.discordClient.sendMessage(
          message.channelId,
          'timesチャンネル（#times-〇〇）の中でメンションしてください 🙏'
        );
        return;
      }

      // times-〇〇 の〇〇をesa週報のユーザー名として扱う
      const channelName = message.channelName;
      const user = await this.taskDb.getUserByChannelName(channelName);

      if (!user) {
        await this.discordClient.sendMessage(
          message.channelId,
          'timesチャンネル（#times-〇〇）の中でメンションしてください 🙏'
        );
        return;
      }

      // メンション部分を除いた本文を取得
      const text = this.discordClient.stripMention(message.content);
      const reportWeek = getJapaneseYearAndWeek(message.timestamp);
      const esaUserName = channelName.slice(config.discord.timesChannelPrefix.length);

      // 自然言語でのタスク操作（LLMで意図を解析して実行）
      const reply = await this.taskOperator.handleCommand(user, text, {
        ...reportWeek,
        userName: esaUserName,
      });
      await this.discordClient.sendToTimesChannelByName(
        user.discord_times_channel_name,
        reply.content,
        reply.components
      );
      for (const additional of reply.additionalMessages ?? []) {
        await this.discordClient.sendToTimesChannelByName(
          user.discord_times_channel_name,
          additional.content,
          additional.components
        );
      }
    } catch (error) {
      console.error('[mention] Failed to handle mention:', error);
    }
  }
}
