import { DiscordClient } from '../mcp/discord-client';
import { TaskDbClient } from '../mcp/task-db';
import { ProgressAnalyzer } from '../skills/progress-analyzer';
import { TaskManager } from '../skills/task-manager';
import { DiscordMessage } from '../types';
import { config } from '../config';

/**
 * Discordリスナーフック
 * Discordのメッセージを監視し、LLMで進捗を判定する
 */
export class DiscordListenerHook {
  private discordClient: DiscordClient;
  private taskDb: TaskDbClient;
  private progressAnalyzer: ProgressAnalyzer;
  private taskManager: TaskManager;

  constructor(
    discordClient: DiscordClient,
    taskDb: TaskDbClient,
    progressAnalyzer: ProgressAnalyzer,
    taskManager: TaskManager
  ) {
    this.discordClient = discordClient;
    this.taskDb = taskDb;
    this.progressAnalyzer = progressAnalyzer;
    this.taskManager = taskManager;
  }

  /**
   * メッセージ監視を開始
   */
  start(): void {
    this.discordClient.onMessage(async (message: DiscordMessage) => {
      await this.handleMessage(message);
    });
    console.log('Discord listener started.');
  }

  /**
   * メッセージを処理
   * @param message Discordメッセージ
   */
  async handleMessage(message: DiscordMessage): Promise<void> {
    try {
      // Botへのメンションはコマンドとして扱うため、進捗解析の対象外にする
      if (this.discordClient.isMentioningMe(message.content)) {
        return;
      }

      // timesプレフィックスのチャンネル以外は無視
      if (
        !message.channelName ||
        !message.channelName.startsWith(config.discord.timesChannelPrefix)
      ) {
        return;
      }

      console.log(
        `[listener] Received message in #${message.channelName}: "${message.content.slice(0, 50)}"`
      );

      // チャンネル名でユーザーを取得
      const user = await this.taskDb.getUserByChannelName(message.channelName);
      if (!user) {
        // ユーザーが登録されていない場合は無視
        return;
      }

      // 現在のタスクを取得
      const tasks = await this.taskManager.getUserTasks(user.id);
      if (tasks.length === 0) {
        return;
      }

      // LLMで進捗を判定
      const analysis = await this.progressAnalyzer.analyze(message, tasks);

      if (!analysis.is_related || analysis.related_task_id === null) {
        // 関連タスクなし
        return;
      }

      // タスクの進捗を更新
      await this.taskManager.updateTaskProgress(
        analysis.related_task_id,
        analysis.progress,
        {
          confidence: analysis.confidence,
          reason: analysis.reason,
          sourceMessageId: message.id,
        }
      );

      console.log(
        `Task ${analysis.related_task_id} updated to ${analysis.progress} ` +
        `(confidence: ${analysis.confidence})`
      );
    } catch (error) {
      console.error('Message handling failed:', error);
    }
  }
}