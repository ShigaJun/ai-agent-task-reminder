import fs from 'fs';
import path from 'path';
import { LlmClient } from '../mcp/llm-client';
import { Task, TaskOperationIntent } from '../types';

const VALID_ACTIONS = ['add_task', 'complete_task', 'delete_task', 'list_tasks', 'unknown'];

/**
 * タスク操作意図の解析スキル
 * メンションメッセージをLLMで解析し、構造化された操作意図（JSON）を返す
 * ※ DBやesaの実際の更新は TaskOperator（通常のプログラム）が行う
 */
export class TaskOperationAnalyzer {
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
    const promptPath = path.join(__dirname, '../../prompts/task-operation.md');
    const content = fs.readFileSync(promptPath, 'utf-8');

    const systemPromptMatch = content.match(/## システムプロンプト\n([\s\S]*?)(?=\n## )/);
    if (systemPromptMatch) {
      return systemPromptMatch[1].trim();
    }

    return 'あなたはタスク管理アシスタントです。ユーザーの意図を判定してJSONのみを出力します。';
  }

  /**
   * メッセージと現在のタスク一覧から操作意図を解析する
   * @param text メンション部分を除去したユーザーメッセージ
   * @param tasks 現在のタスク一覧（complete_taskの対象推定に使う）
   */
  async analyze(text: string, tasks: Task[]): Promise<TaskOperationIntent> {
    const tasksText =
      tasks.length > 0
        ? tasks.map((t) => `- id: ${t.id}, task: ${t.task_text}, status: ${t.status}`).join('\n')
        : '（現在タスクはありません）';

    const prompt = `## 現在のタスク一覧\n${tasksText}\n\n## ユーザーのメッセージ\n${text}`;

    try {
      const intent = await this.llmClient.generateJsonResponse<TaskOperationIntent>(
        prompt,
        this.systemPrompt
      );

      // LLMの出力を正規化（型の揺れ・不正値への防御）
      return {
        action: VALID_ACTIONS.includes(intent.action) ? intent.action : 'unknown',
        task_id: typeof intent.task_id === 'number' ? intent.task_id : null,
        task_title: typeof intent.task_title === 'string' ? intent.task_title : null,
        new_task:
          typeof intent.new_task === 'string' && intent.new_task.trim()
            ? intent.new_task.trim()
            : null,
        confidence: typeof intent.confidence === 'number' ? intent.confidence : 0,
      };
    } catch (error) {
      console.error('[task-operation-analyzer] Analysis failed:', error);
      return { action: 'unknown', task_id: null, task_title: null, new_task: null, confidence: 0 };
    }
  }
}
