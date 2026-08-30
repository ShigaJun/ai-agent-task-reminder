import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Task, TaskStatus } from '../types';

/**
 * ボタンのcustomIdのプレフィックス
 */
export const TOGGLE_PREFIX = 'task-toggle:';

/**
 * チェックリストメッセージのヘッダー
 */
export const CHECKLIST_HEADER = '📋 **来週やること（計画）**';

/**
 * 1行に置けるボタン数（Discordの仕様: 最大5個/行）
 */
const MAX_BUTTONS_PER_ROW = 5;

/**
 * アクション行の最大数（Discordの仕様: 最大5行/メッセージ）
 */
const MAX_ROWS = 5;

/**
 * ボタンを付けられるタスク数の上限（5 × 5 = 25）
 */
export const MAX_BUTTON_TASKS = MAX_BUTTONS_PER_ROW * MAX_ROWS;

/**
 * ボタンのラベルの最大文字数（Discordの仕様: 80文字）
 */
const MAX_LABEL_LENGTH = 80;

const STATUS_ICON: Record<TaskStatus, string> = {
  todo: '⬜', // 未完了（チェックなし）
  in_progress: '🔄', // 進行中
  completed: '✅', // 完了（チェック済み）
};

/**
 * タスク一覧の本文（状態絵文字付きの行）を生成する
 */
export function buildChecklistContent(tasks: Task[], header: string = CHECKLIST_HEADER): string {
  const lines = tasks.map((task) => `${STATUS_ICON[task.status]} ${task.task_text}`);
  let content = `${header}\n\n${lines.join('\n')}`;
  if (tasks.length > MAX_BUTTON_TASKS) {
    content += `\n\n（タスクが多いため、先頭${MAX_BUTTON_TASKS}件のみボタンでチェックできます）`;
  }
  return content;
}

/**
 * タスクをクリックで切り替えるためのボタン行を生成する
 * ※ Discordの仕様上、最大 5個×5行 = 25個まで
 */
export function buildChecklistComponents(tasks: Task[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const interactiveTasks = tasks.slice(0, MAX_BUTTON_TASKS);

  for (let i = 0; i < interactiveTasks.length; i += MAX_BUTTONS_PER_ROW) {
    const chunk = interactiveTasks.slice(i, i + MAX_BUTTONS_PER_ROW);
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const task of chunk) {
      const completed = task.status === 'completed';
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${TOGGLE_PREFIX}${task.id}`)
          .setLabel(truncate(`${completed ? '✅' : '⬜'} ${task.task_text}`, MAX_LABEL_LENGTH))
          .setStyle(completed ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
    }
    rows.push(row);
  }

  return rows;
}

/**
 * 本文+ボタン行をまとめて生成する（週次タスク送信・達成度チェック用）
 */
export function buildChecklistMessage(
  tasks: Task[],
  header: string = CHECKLIST_HEADER
): {
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  return {
    content: buildChecklistContent(tasks, header),
    components: buildChecklistComponents(tasks),
  };
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
