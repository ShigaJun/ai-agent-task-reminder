import { ButtonInteraction, MessageFlags } from 'discord.js';
import { DiscordClient } from '../mcp/discord-client';
import { TaskDbClient } from '../mcp/task-db';
import {
  buildChecklistComponents,
  buildChecklistContent,
  TOGGLE_PREFIX,
} from '../skills/checklist-builder';

/**
 * チェックリストボタンのクリック処理フック
 * timesチャンネルに投稿されたタスクチェックリストのボタンで
 * タスクの未完了⇄完了を切り替える
 */
export class ChecklistInteractionHook {
  private discordClient: DiscordClient;
  private taskDb: TaskDbClient;

  constructor(discordClient: DiscordClient, taskDb: TaskDbClient) {
    this.discordClient = discordClient;
    this.taskDb = taskDb;
  }

  /**
   * インタラクション処理を開始
   */
  start(): void {
    this.discordClient.onInteraction(async (interaction) => {
      if (!interaction.isButton()) return;
      if (!interaction.customId.startsWith(TOGGLE_PREFIX)) return;
      await this.handleToggle(interaction);
    });
    console.log('Checklist interaction handler started.');
  }

  /**
   * ボタンクリックでタスク状態をトグルする（未完了⇄完了の2状態）
   * @param interaction ボタンのインタラクション
   */
  private async handleToggle(interaction: ButtonInteraction): Promise<void> {
    try {
      // Discordは3秒以内の応答を要求するため、まずdeferで応答しておく
      await interaction.deferUpdate();

      // customId: "task-toggle:<taskId>" からタスクIDを取り出す
      const taskId = Number(interaction.customId.slice(TOGGLE_PREFIX.length));
      if (!Number.isInteger(taskId) || taskId <= 0) {
        return;
      }

      // タスクを取得して状態をトグル（未完了⇄完了）
      const task = await this.taskDb.getTaskById(taskId);
      const newStatus = task.status === 'completed' ? 'todo' : 'completed';
      const updated = await this.taskDb.updateTaskStatus(taskId, newStatus, {
        reason: 'チェックリストのボタンで手動切り替え',
        sourceMessageId: interaction.message.id,
      });

      // 同一ユーザーのタスク一覧でメッセージを再構築して編集
      // ※ 同じ週報(esa_post_url)に紐づくタスクのみを対象にする。
      //    LLM生成文などチェックリスト以外の本文は温存し、
      //    チェックリスト本文のみ更新する
      const allTasks = await this.taskDb.getTasks(updated.user_id);
      const tasks = updated.esa_post_url
        ? allTasks.filter((t) => t.esa_post_url === updated.esa_post_url)
        : allTasks;
      const originalContent = interaction.message.content ?? '';
      // チェックリスト形式のメッセージ(📋で始まる)なら、元のヘッダー行を保ちつつ本文を更新する
      const isChecklistMessage = originalContent.startsWith('📋');
      const content = isChecklistMessage
        ? buildChecklistContent(tasks, originalContent.split('\n')[0])
        : originalContent;
      await interaction.editReply({
        content,
        components: buildChecklistComponents(tasks),
      });

      console.log(`[checklist] Task ${taskId} toggled to ${newStatus}.`);
    } catch (error) {
      console.error('[checklist] Failed to toggle task:', error);
      // deferUpdate前の失敗であれば、ユーザーに失敗を通知できる
      if (!interaction.deferred && !interaction.replied) {
        await interaction
          .reply({ content: 'タスクの更新に失敗しました。', flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    }
  }
}
