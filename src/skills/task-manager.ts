import { TaskDbClient } from '../mcp/task-db';
import { EsaClient } from '../mcp/esa-client';
import { MarkdownParser } from '../utils/markdown-parser';
import { Task, TaskStatus, User } from '../types';

/**
 * タスク管理スキル
 * esaからタスクを取得し、DBに保存・管理する
 */
export class TaskManager {
  private taskDb: TaskDbClient;
  private esaClient: EsaClient;

  constructor(taskDb: TaskDbClient, esaClient: EsaClient) {
    this.taskDb = taskDb;
    this.esaClient = esaClient;
  }

  /**
   * 週報からタスクを取得し、DBに保存する
   * @param userId ユーザーID
   * @returns 保存されたタスク配列
   */
  async fetchAndSaveWeeklyTasks(userId: number): Promise<Task[]> {
    const user = await this.taskDb.getUserById(userId);

    // timesチャンネル名の末尾からesaユーザー名を導出（例: times-wata_haru -> wata_haru）
    const esaUserName = user.discord_times_channel_name.replace(/^times-/, '');

    // 1. esaからユーザーの週報を取得
    const weeklyReport = await this.esaClient.getWeeklyReport(undefined, undefined, esaUserName);

    if (!weeklyReport) {
      console.log(`No weekly report found in esa for user ${esaUserName}.`);
      return [];
    }

    // 2. Markdownからタスクを抽出
    const extractedTasks = MarkdownParser.extractTasks(weeklyReport.bodyMarkdown);

    if (extractedTasks.length === 0) {
      console.log(`No tasks found in weekly report for ${esaUserName}.`);
      return [];
    }

    // 3. タスクをDBに保存（同一テキストのタスクは重複登録せず既存行を再利用する）
    const savedTasks: Task[] = [];
    for (const extractedTask of extractedTasks) {
      const existing = await this.taskDb.findTaskByUserIdAndText(userId, extractedTask.task);

      if (existing) {
        let current = existing;

        // 週報で「完了」チェックが付いていれば完了に更新する
        // ※ 未完了への自動ダウングレードはしない（手動のボタン操作での完了を尊重）
        if (extractedTask.status === 'completed' && current.status !== 'completed') {
          current = await this.taskDb.updateTaskStatus(current.id, 'completed', {
            reason: '週報の完了チェックを反映',
          });
        }

        // 紐づく週報を最新のものに更新する
        if (current.esa_post_url !== weeklyReport.url) {
          current = await this.taskDb.updateTaskEsaPostUrl(current.id, weeklyReport.url);
        }

        savedTasks.push(current);
      } else {
        const task = await this.taskDb.createTask({
          userId,
          taskText: extractedTask.task,
          status: extractedTask.status,
          esaPostUrl: weeklyReport.url,
        });
        savedTasks.push(task);
      }
    }

    console.log(`Saved ${savedTasks.length} tasks from weekly report for ${esaUserName}.`);
    return savedTasks;
  }

  /**
   * ユーザーの現在のタスクを取得
   * @param userId ユーザーID
   * @param status フィルターするステータス（省略可）
   * @returns タスク配列
   */
  async getUserTasks(userId: number, status?: TaskStatus): Promise<Task[]> {
    return this.taskDb.getTasks(userId, status ? { status } : undefined);
  }

  /**
   * タスクの進捗を更新
   * @param taskId タスクID
   * @param status 新しいステータス
   * @param metadata メタデータ（信頼度、理由、メッセージID）
   */
  async updateTaskProgress(
    taskId: number,
    status: TaskStatus,
    metadata?: {
      confidence?: number;
      reason?: string;
      sourceMessageId?: string;
    }
  ): Promise<Task> {
    return this.taskDb.updateTaskStatus(taskId, status, metadata);
  }

  /**
   * 未完了タスクを取得
   * @param userId ユーザーID
   * @returns 未完了タスク配列
   */
  async getIncompleteTasks(userId: number): Promise<Task[]> {
    const tasks = await this.taskDb.getTasks(userId);
    return tasks.filter((t) => t.status !== 'completed');
  }
}