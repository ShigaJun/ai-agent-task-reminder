import { ExtractedTask, TaskStatus } from '../types';

/**
 * Markdownのチェックボックスからタスクを抽出するユーティリティ
 * LLMは使用せず、正規表現で処理する
 */
export class MarkdownParser {
  /**
   * Markdownテキストから「来週やること（計画）」セクションのタスクを抽出
   * @param markdown Markdownテキスト
   * @returns 抽出されたタスク配列
   */
  static extractTasks(markdown: string): ExtractedTask[] {
    const tasks: ExtractedTask[] = [];

    // 「来週やること（計画）」セクションを探す
    const sectionRegex = /#+\s*来週やること.*?\n([\s\S]*?)(?=\n#+\s|\n\n#+\s|$)/i;
    const sectionMatch = markdown.match(sectionRegex);

    if (!sectionMatch) {
      // セクションが見つからない場合、全体からチェックボックスを抽出
      return this.extractCheckboxes(markdown);
    }

    const sectionContent = sectionMatch[1];
    return this.extractCheckboxes(sectionContent);
  }

  /**
   * Markdownテキストからチェックボックス形式のタスクを抽出
   * @param text テキスト
   * @returns 抽出されたタスク配列
   */
  static extractCheckboxes(text: string): ExtractedTask[] {
    const tasks: ExtractedTask[] = [];

    // チェックボックスの正規表現: - [ ] または - [x] または * [ ] または * [x]
    const checkboxRegex = /^[\s]*[-*]\s*\[([ xX])\]\s*(.+)$/gm;

    let match;
    while ((match = checkboxRegex.exec(text)) !== null) {
      const isChecked = match[1].toLowerCase() === 'x';
      const taskText = match[2].trim();

      if (taskText) {
        const status: TaskStatus = isChecked ? 'completed' : 'todo';
        tasks.push({
          task: taskText,
          status,
        });
      }
    }

    return tasks;
  }

  /**
   * タスクのステータスを更新する
   * @param tasks 現在のタスク配列
   * @param taskText 更新するタスクのテキスト
   * @param newStatus 新しいステータス
   * @returns 更新されたタスク配列
   */
  static updateTaskStatus(
    tasks: ExtractedTask[],
    taskText: string,
    newStatus: TaskStatus
  ): ExtractedTask[] {
    return tasks.map((task) => {
      if (task.task === taskText) {
        return { ...task, status: newStatus };
      }
      return task;
    });
  }

  /**
   * 「来週やること」セクションの末尾にチェックボックス形式でタスクを追加した本文を返す
   * セクションが存在しない場合は本文の末尾にセクションごと追加する
   * ※ 元の文字列は破壊しない（新しい文字列を返す）
   * @param markdown esa記事の本文（Markdown）
   * @param taskText 追加するタスク名
   * @returns 更新後の本文
   */
  static appendTaskToNextWeekSection(markdown: string, taskText: string): string {
    const sectionRegex = /(#+\s*来週やること.*?\n)([\s\S]*?)(?=\n#+\s|\n\n#+\s|$)/i;
    const match = markdown.match(sectionRegex);

    if (!match) {
      // セクションが無い場合は末尾にセクションごと追加
      return `${markdown.trimEnd()}\n\n## 来週やること（計画）\n\n- [ ] ${taskText}\n`;
    }

    const start = match.index ?? 0;
    const header = match[1];
    const content = match[2];

    // 末尾の空行を整えてから、最後のチェックボックス行の後に挿入する
    const lines = content.replace(/\s+$/, '').split('\n');
    let insertIndex = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^[\s]*[-*]\s*\[([ xX])\]/.test(lines[i])) {
        insertIndex = i + 1;
        break;
      }
    }
    lines.splice(insertIndex, 0, `- [ ] ${taskText}`);

    const after = markdown.slice(start + match[0].length);
    return `${markdown.slice(0, start)}${header}${lines.join('\n')}\n${after}`;
  }

  /**
   * 本文内の指定タスクのチェックボックスを完了(- [x])に変更した本文を返す
   * 該当行のチェックボックスのみを書き換え、他の内容は変更しない
   * @param markdown esa記事の本文（Markdown）
   * @param taskText 対象タスク名（DBに保存されているものと完全一致）
   * @returns 更新後の本文。該当行が見つからない場合はnull
   */
  static completeTaskCheckbox(markdown: string, taskText: string): string | null {
    // 正規表現の特殊文字をエスケープ
    const escaped = taskText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lineRegex = new RegExp(
      `^[ \\t]*[-*][ \\t]*\\[([ xX])\\][ \\t]*${escaped}[ \\t]*$`,
      'm'
    );
    const match = markdown.match(lineRegex);
    if (!match) {
      return null;
    }
    if (match[1].toLowerCase() === 'x') {
      return markdown; // 既に完了済みなら何もしない
    }
    // 該当行のチェックボックスだけ [ ] → [x] に置換する
    return markdown.replace(lineRegex, (line) => line.replace(/\[([ xX])\]/, '[x]'));
  }

  /**
   * 「来週やること」内の指定タスクのチェックボックス行を削除する。
   * 同名行が他セクションにあっても削除しない。
   */
  static removeTaskCheckbox(markdown: string, taskText: string): string | null {
    const sectionRegex = /(#+\s*来週やること.*?\n)([\s\S]*?)(?=\n#+\s|\n\n#+\s|$)/i;
    const sectionMatch = markdown.match(sectionRegex);
    if (!sectionMatch) {
      return null;
    }

    const escaped = taskText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskLineRegex = new RegExp(
      `^[ \\t]*[-*][ \\t]*\\[([ xX])\\][ \\t]*${escaped}[ \\t]*(?:\\n|$)`,
      'm'
    );
    if (!taskLineRegex.test(sectionMatch[2])) {
      return null;
    }

    const updatedContent = sectionMatch[2].replace(taskLineRegex, '');
    return markdown.replace(sectionMatch[0], `${sectionMatch[1]}${updatedContent}`);
  }
}
