import { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { config } from '../config';
import { TaskDbClient } from '../mcp/task-db';
import { EsaClient } from '../mcp/esa-client';
import { TaskOperationAnalyzer } from './task-operation-analyzer';
import { TaskManager } from './task-manager';
import { MarkdownParser } from '../utils/markdown-parser';
import { filterLatestReportTasks } from '../utils/task-utils';
import { buildChecklistComponents, MAX_BUTTON_TASKS } from './checklist-builder';
import { Task, TaskOperationIntent, User } from '../types';

export interface ReplyPayload {
  content: string;
  components?: ActionRowBuilder<ButtonBuilder>[];
  additionalMessages?: ReplyPayload[];
}

export interface WeeklyReportTarget {
  year: string;
  weekNumber: number;
  userName: string;
}

const UNKNOWN_REPLY = [
  'タスクの操作を手伝います 👀',
  '- 追加: 「ゼミ制作 追加して」',
  '- 完了: 「ゼミ制作終わった」',
  '- 削除: 「ゼミ制作を削除して」',
  '- 一覧: 「今週やること教えて」',
].join('\n');

/**
 * タスク操作のオーケストレーター
 * LLMの解析結果（構造化JSON）に基づき、DB・esa・Discord返信の生成を行う
 * ※ LLMが直接DBやesaを操作することはない
 */
export class TaskOperator {
  private taskDb: TaskDbClient;
  private esaClient: EsaClient;
  private analyzer: TaskOperationAnalyzer;
  private taskManager: TaskManager;

  constructor(
    taskDb: TaskDbClient,
    esaClient: EsaClient,
    analyzer: TaskOperationAnalyzer,
    taskManager: TaskManager
  ) {
    this.taskDb = taskDb;
    this.esaClient = esaClient;
    this.analyzer = analyzer;
    this.taskManager = taskManager;
  }

  /**
   * メンションメッセージを解析し、タスク操作を実行して返信用メッセージを組み立てる
   * ※ 実際のDiscord送信は呼び出し側（MentionHandlerHook）が行う
   * @param user 対象ユーザー（メンションされたtimesチャンネルの持ち主）
   * @param text メンション部分を除去したユーザーメッセージ
   */
  async handleCommand(
    user: User,
    text: string,
    reportTarget: WeeklyReportTarget
  ): Promise<ReplyPayload> {
    // @リマインダーbotで呼び出された時点のesa内容をDBへ反映してから操作する
    await this.taskManager.fetchAndSaveWeeklyTasks(
      user.id,
      reportTarget.year,
      reportTarget.weekNumber
    );
    const allTasks = await this.taskDb.getTasks(user.id);
    const currentTasks = filterLatestReportTasks(allTasks);

    // 1. LLMで意図を解析
    const intent = await this.analyzer.analyze(text, currentTasks);
    console.log(`[task-operator] intent: ${JSON.stringify(intent)}`);

    // 2. unknown は何も操作しない
    if (intent.action === 'unknown') {
      return { content: UNKNOWN_REPLY };
    }

    // 3. confidenceが低い場合は勝手に操作しない
    if (intent.confidence < config.llm.confidenceThreshold) {
      return this.lowConfidenceReply(intent, currentTasks);
    }

    // 4. actionに応じた処理
    switch (intent.action) {
      case 'add_task':
        return this.addTask(user, intent, reportTarget);
      case 'complete_task':
        return this.completeTask(intent, currentTasks);
      case 'delete_task':
        return this.deleteTask(intent, currentTasks);
      case 'list_tasks':
        return this.listTasks(currentTasks);
      default:
        return { content: UNKNOWN_REPLY };
    }
  }

  /**
   * タスク追加: esa記事の「来週やること」に追記し、DBにも追加する
   */
  private async addTask(
    user: User,
    intent: TaskOperationIntent,
    reportTarget: WeeklyReportTarget
  ): Promise<ReplyPayload> {
    const taskText = intent.new_task?.trim();
    if (!taskText) {
      return {
        content:
          '追加するタスク名を特定できませんでした。「〇〇を追加して」のように教えてもらえますか？ 🙏',
      };
    }

    // 1. メンション時刻に対応するesa週報を取得して「来週やること」に追記する
    //    （esaを先に更新。esaの追記に失敗した場合はDBを触らずエラーを返す）
    const report = await this.esaClient.getWeeklyReport(
      reportTarget.year,
      reportTarget.weekNumber,
      reportTarget.userName
    );

    if (!report) {
      return {
        content:
          `esa記事「週報/${reportTarget.year}/${reportTarget.weekNumber}/` +
          `${reportTarget.userName}」が見つからないため、追加していません 🙏`,
      };
    }

    const newBody = MarkdownParser.appendTaskToNextWeekSection(report.bodyMarkdown, taskText);
    await this.esaClient.updatePostBody(report.number, newBody);

    // 2. DBへ追加
    await this.taskDb.createTask({
      userId: user.id,
      taskText,
      status: 'todo',
      esaPostUrl: report.url,
    });

    return { content: `「${taskText}」を来週やることに追加しました 👀` };
  }

  /**
   * タスク完了: DBのステータス更新と、esa記事のチェックボックス更新を行う
   */
  private async completeTask(
    intent: TaskOperationIntent,
    currentTasks: Task[]
  ): Promise<ReplyPayload> {
    const incomplete = currentTasks.filter((t) => t.status !== 'completed');

    // 対象タスクの特定
    let target: Task | undefined;
    if (intent.task_id != null) {
      target = currentTasks.find((t) => t.id === intent.task_id);
    } else if (intent.task_title) {
      const title = intent.task_title.trim();
      const candidates = incomplete.filter(
        (t) => t.task_text.includes(title) || title.includes(t.task_text)
      );
      if (candidates.length === 1) {
        target = candidates[0];
      } else if (candidates.length > 1) {
        // 曖昧な場合は更新せず候補を提示する
        return ambiguousReply(candidates);
      }
    }

    if (!target) {
      if (incomplete.length === 0) {
        return { content: '未完了のタスクはありません 🎉' };
      }
      return ambiguousReply(incomplete);
    }

    if (target.status === 'completed') {
      return { content: `「${target.task_text}」は既に完了しています ✅` };
    }

    // 1. DBのステータスを更新
    await this.taskDb.updateTaskStatus(target.id, 'completed', {
      reason: 'メンションによる完了操作',
    });

    // 2. esaのチェックボックスを更新（失敗してもDB更新は維持し、返信に警告を添える）
    let esaNote = '';
    if (target.esa_post_url) {
      try {
        const postNumber = Number(target.esa_post_url.split('/').pop());
        const post = await this.esaClient.getPost(postNumber);
        if (post) {
          const newBody = MarkdownParser.completeTaskCheckbox(post.bodyMarkdown, target.task_text);
          if (newBody === null) {
            esaNote = '\n※esa記事に該当するチェックボックスが見つからず、esa側は未更新です';
          } else {
            await this.esaClient.updatePostBody(postNumber, newBody);
          }
        }
      } catch (error) {
        console.error('[task-operator] esa update failed:', error);
        esaNote = '\n⚠️ esa記事の更新に失敗しました（DBは更新済み）';
      }
    }

    return { content: `「${target.task_text}」を完了にしました 🎉${esaNote}` };
  }

  /**
   * esaの「来週やること」から行を削除し、成功後にDBからも削除する
   */
  private async deleteTask(
    intent: TaskOperationIntent,
    currentTasks: Task[]
  ): Promise<ReplyPayload> {
    let target: Task | undefined;
    if (intent.task_id != null) {
      target = currentTasks.find((t) => t.id === intent.task_id);
    } else if (intent.task_title) {
      const title = intent.task_title.trim();
      const candidates = currentTasks.filter(
        (t) => t.task_text.includes(title) || title.includes(t.task_text)
      );
      if (candidates.length === 1) {
        target = candidates[0];
      } else if (candidates.length > 1) {
        return ambiguousDeleteReply(candidates);
      }
    }

    if (!target) {
      return currentTasks.length > 0
        ? ambiguousDeleteReply(currentTasks)
        : { content: '削除できるタスクはありません 👀' };
    }
    if (!target.esa_post_url) {
      return { content: `「${target.task_text}」に対応するesa記事がないため、削除していません 🙏` };
    }

    const postNumber = Number(target.esa_post_url.split('/').pop());
    const post = await this.esaClient.getPost(postNumber);
    if (!post) {
      return { content: `「${target.task_text}」に対応するesa記事が見つからないため、削除していません 🙏` };
    }

    const newBody = MarkdownParser.removeTaskCheckbox(post.bodyMarkdown, target.task_text);
    if (newBody === null) {
      return { content: `esa記事の「来週やること」に「${target.task_text}」が見つからないため、削除していません 🙏` };
    }

    // esaの更新に成功した場合だけDBを削除し、両者の不整合を避ける
    await this.esaClient.updatePostBody(postNumber, newBody);
    await this.taskDb.deleteTask(target.id);
    return { content: `「${target.task_text}」を来週やることから削除しました 🗑️` };
  }

  /**
   * タスク一覧の返信
   */
  private listTasks(currentTasks: Task[]): ReplyPayload {
    if (currentTasks.length === 0) {
      return { content: '今週のタスクはありません 👀' };
    }
    const chunks: Task[][] = [];
    for (let i = 0; i < currentTasks.length; i += MAX_BUTTON_TASKS) {
      chunks.push(currentTasks.slice(i, i + MAX_BUTTON_TASKS));
    }
    const messages = chunks.map((tasks, index): ReplyPayload => ({
      content:
        chunks.length === 1
          ? '📋 **今週のタスク**'
          : `📋 **今週のタスク（${index + 1}/${chunks.length}）**`,
      components: buildChecklistComponents(tasks),
    }));
    return {
      ...messages[0],
      additionalMessages: messages.slice(1),
    };
  }

  /**
   * 低信頼度の場合の返信（勝手に操作しない）
   */
  private lowConfidenceReply(intent: TaskOperationIntent, currentTasks: Task[]): ReplyPayload {
    if (intent.action === 'add_task' && intent.new_task) {
      return {
        content: `「${intent.new_task}」を追加したいという理解で合っていますか？\n「@リマインダーbot ${intent.new_task} を追加して」と教えてもらえれば実行します 🙏`,
      };
    }
    if (intent.action === 'complete_task' && intent.task_title) {
      const candidates = currentTasks.filter(
        (t) =>
          t.status !== 'completed' &&
          (t.task_text.includes(intent.task_title!) ||
            intent.task_title!.includes(t.task_text))
      );
      if (candidates.length > 0) {
        return ambiguousReply(candidates);
      }
    }
    if (intent.action === 'delete_task' && intent.task_title) {
      const candidates = currentTasks.filter(
        (t) =>
          t.task_text.includes(intent.task_title!) ||
          intent.task_title!.includes(t.task_text)
      );
      if (candidates.length > 0) {
        return ambiguousDeleteReply(candidates);
      }
    }
    return {
      content:
        '意図を確定できなかったため、タスクは更新していません。\n「追加して」「終わった」「教えて」のように教えてもらえますか？ 🙏',
    };
  }
}

/**
 * 曖昧な場合に候補を提示する返信（MVPでは選択UIはなし）
 */
function ambiguousReply(candidates: Task[]): ReplyPayload {
  const lines = candidates.map((t, i) => `${i + 1}. ${t.task_text}`).join('\n');
  return {
    content: `どのタスクを完了にしますか？\n\n${lines}`,
  };
}

function ambiguousDeleteReply(candidates: Task[]): ReplyPayload {
  const lines = candidates.map((t, i) => `${i + 1}. ${t.task_text}`).join('\n');
  return {
    content: `どのタスクを削除しますか？\n\n${lines}`,
  };
}
