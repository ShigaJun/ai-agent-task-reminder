import fs from 'fs';
import path from 'path';
import { LlmClient } from '../mcp/llm-client';
import { Task } from '../types';

/**
 * リマインド生成スキル
 * タスク状況に応じてLLMでリマインドメッセージを生成する
 */
export class ReminderGenerator {
  private llmClient: LlmClient;
  private systemPrompt: string;

  constructor(llmClient: LlmClient) {
    this.llmClient = llmClient;
    this.systemPrompt = this.loadSystemPrompt();
  }

  /**
   * プロンプトテンプレートを読み込む
   */
  private loadSystemPrompt(): string {
    const promptPath = path.join(__dirname, '../../prompts/reminder-generation.md');
    const content = fs.readFileSync(promptPath, 'utf-8');

    // システムプロンプト部分を抽出
    const systemPromptMatch = content.match(/## システムプロンプト\n([\s\S]*?)(?=\n## )/);
    if (systemPromptMatch) {
      return systemPromptMatch[1].trim();
    }

    return 'あなたはAIタスク管理アシスタントです。';
  }

  /**
   * タスク情報をテキスト形式に整形
   */
  private formatTasks(tasks: Task[]): string {
    if (tasks.length === 0) {
      return 'タスクはありません。';
    }

    return tasks
      .map((t) => {
        const statusEmoji = {
          todo: '📋',
          in_progress: '🔄',
          completed: '✅',
        }[t.status];

        return `${statusEmoji} ${t.task_text} (${t.status})`;
      })
      .join('\n');
  }

  /**
   * 月曜日のタスク通知を生成
   * @param tasks 今週のタスク
   * @param reminderCount 過去のリマインド回数
   */
  async generateMondayReminder(tasks: Task[], reminderCount: number = 0): Promise<string> {
    const tasksText = this.formatTasks(tasks);
    const prompt = `## タスク情報
${tasksText}

## リマインドタイプ
monday

## 過去のリマインド回数
${reminderCount}回`;

    return this.llmClient.generateResponse(prompt, this.systemPrompt);
  }

  /**
   * 水曜日の進捗確認を生成
   * @param tasks 今週のタスク
   * @param reminderCount 過去のリマインド回数
   */
  async generateWednesdayReminder(tasks: Task[], reminderCount: number = 0): Promise<string> {
    const tasksText = this.formatTasks(tasks);
    const prompt = `## タスク情報
${tasksText}

## リマインドタイプ
wednesday

## 過去のリマインド回数
${reminderCount}回`;

    return this.llmClient.generateResponse(prompt, this.systemPrompt);
  }

  /**
   * 金曜日の未完了タスク催促を生成
   * @param tasks 今週のタスク
   * @param reminderCount 過去のリマインド回数
   */
  async generateFridayReminder(tasks: Task[], reminderCount: number = 0): Promise<string> {
    const tasksText = this.formatTasks(tasks);
    const prompt = `## タスク情報
${tasksText}

## リマインドタイプ
friday

## 過去のリマインド回数
${reminderCount}回`;

    return this.llmClient.generateResponse(prompt, this.systemPrompt);
  }
}