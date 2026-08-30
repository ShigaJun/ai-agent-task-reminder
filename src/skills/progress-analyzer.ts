import fs from 'fs';
import path from 'path';
import { LlmClient } from '../mcp/llm-client';
import { Task, DiscordMessage, ProgressAnalysisResult, TaskStatus } from '../types';
import { config } from '../config';

/**
 * 進捗分析スキル
 * Discordの投稿内容をLLMで解析し、タスクの進捗を判定する
 */
export class ProgressAnalyzer {
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
    const promptPath = path.join(__dirname, '../../prompts/progress-analysis.md');
    const content = fs.readFileSync(promptPath, 'utf-8');

    // システムプロンプト部分を抽出
    const systemPromptMatch = content.match(/## システムプロンプト\n([\s\S]*?)(?=\n## )/);
    if (systemPromptMatch) {
      return systemPromptMatch[1].trim();
    }

    return 'あなたはAIタスク管理アシスタントです。';
  }

  /**
   * Discord投稿とタスクの関連性を判定し、進捗を推定する
   * @param message Discordメッセージ
   * @param tasks 現在のタスクリスト
   * @returns 進捗分析結果
   */
  async analyze(message: DiscordMessage, tasks: Task[]): Promise<ProgressAnalysisResult> {
    // タスク情報を整形
    const tasksText = tasks
      .map((t) => `- id: ${t.id}, task: ${t.task_text}, status: ${t.status}`)
      .join('\n');

    const prompt = `## 現在のタスク
${tasksText}

## ユーザーの投稿
- 投稿者: ${message.author.username}
- 内容: ${message.content}
- 投稿時刻: ${message.timestamp}`;

    try {
      const result = await this.llmClient.generateJsonResponse<ProgressAnalysisResult>(
        prompt,
        this.systemPrompt
      );

      // 信頼度チェック
      if (result.confidence < config.llm.confidenceThreshold) {
        console.log(
          `Low confidence (${result.confidence}) for message: ${message.content}. Skipping update.`
        );
        return {
          ...result,
          is_related: false,
        };
      }

      return result;
    } catch (error) {
      console.error('Progress analysis failed:', error);
      return {
        related_task_id: null,
        is_related: false,
        progress: 'todo',
        confidence: 0,
        reason: `分析エラー: ${error}`,
      };
    }
  }

  /**
   * タスクの進捗を更新する
   * @param taskId タスクID
   * @param progress 新しい進捗状態
   * @param confidence 信頼度
   * @param reason 判定理由
   * @param sourceMessageId ソースメッセージID
   * @returns 更新されたタスク
   */
  async updateTaskProgress(
    taskId: number,
    progress: TaskStatus,
    confidence: number,
    reason: string,
    sourceMessageId?: string
  ): Promise<void> {
    // このメソッドはTaskDbClientで実装される
    // ここではビジネスロジックのみ定義
    console.log(
      `Task ${taskId} status updated to ${progress} (confidence: ${confidence})`
    );
  }
}