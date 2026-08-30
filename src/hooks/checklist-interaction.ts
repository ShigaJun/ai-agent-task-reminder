import { ButtonInteraction, MessageFlags } from 'discord.js';
import { DiscordClient } from '../mcp/discord-client';
import { TaskDbClient } from '../mcp/task-db';
import { EsaClient } from '../mcp/esa-client';
import { MarkdownParser } from '../utils/markdown-parser';
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
  private esaClient: EsaClient;

  constructor(discordClient: DiscordClient, taskDb: TaskDbClient, esaClient: EsaClient) {
    this.discordClient = discordClient;
    this.taskDb = taskDb;
    this.esaClient = esaClient;
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

      if (!task.esa_post_url) {
        throw new Error(`Task ${taskId} has no esa post URL.`);
      }
      const postNumber = Number(task.esa_post_url.split('/').pop());
      if (!Number.isInteger(postNumber) || postNumber <= 0) {
        throw new Error(`Task ${taskId} has an invalid esa post URL.`);
      }
      const post = await this.esaClient.getPost(postNumber);
      if (!post) {
        throw new Error(`esa post ${postNumber} was not found.`);
      }
      const newBody = MarkdownParser.setTaskCheckboxStatus(
        post.bodyMarkdown,
        task.task_text,
        newStatus === 'completed'
      );
      if (newBody === null) {
        throw new Error(`Task checkbox was not found in esa post ${postNumber}.`);
      }

      // esaを先に更新し、成功した場合だけDBへ反映する
      await this.esaClient.updatePostBody(postNumber, newBody);
      const updated = await this.taskDb.updateTaskStatus(taskId, newStatus, {
        reason: 'チェックリストのボタンで手動切り替え',
        sourceMessageId: interaction.message.id,
      });

      // このメッセージに含まれるタスクだけでボタンを再構築する。
      // 一覧が複数メッセージに分割されていても、他のページと混ざらないようにする。
      //    LLM生成文などチェックリスト以外の本文は温存し、
      //    チェックリスト本文のみ更新する
      const allTasks = await this.taskDb.getTasks(updated.user_id);
      const extractedTaskIds = collectTaskIds(interaction.message.components);
      const messageTaskIds = extractedTaskIds.length > 0 ? extractedTaskIds : [taskId];
      const taskOrder = new Map(messageTaskIds.map((id, index) => [id, index]));
      const tasks = allTasks
        .filter((candidate) => taskOrder.has(candidate.id))
        .sort((a, b) => taskOrder.get(a.id)! - taskOrder.get(b.id)!);
      const originalContent = interaction.message.content ?? '';
      // チェックリスト形式のメッセージ(📋で始まる)なら、元のヘッダー行を保ちつつ本文を更新する
      const isChecklistMessage = originalContent.startsWith('📋');
      const hasTaskLines = originalContent.includes('\n');
      const content = isChecklistMessage && hasTaskLines
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
      } else {
        await interaction
          .followUp({
            content: 'esaへの反映に失敗したため、タスクの状態は変更していません。',
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
    }
  }
}

function collectTaskIds(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectTaskIds);
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const component = value as { customId?: unknown; components?: unknown };
  const ids: number[] = [];
  if (typeof component.customId === 'string' && component.customId.startsWith(TOGGLE_PREFIX)) {
    const id = Number(component.customId.slice(TOGGLE_PREFIX.length));
    if (Number.isInteger(id)) {
      ids.push(id);
    }
  }
  if (component.components !== undefined) {
    ids.push(...collectTaskIds(component.components));
  }
  return ids;
}
