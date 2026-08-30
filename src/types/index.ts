// 共通型定義

export type TaskStatus = 'todo' | 'in_progress' | 'completed';

/**
 * リマインド履歴の種類
 */
export type ReminderType =
  | 'monday'
  | 'wednesday'
  | 'friday'
  | 'progress-check'
  | 'weekly-tasks';

export interface User {
  id: number;
  esa_user_id: string;
  discord_user_id: string;
  discord_times_channel_name: string;
  created_at: string;
}

export interface Task {
  id: number;
  user_id: number;
  task_text: string;
  status: TaskStatus;
  esa_post_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskProgressHistory {
  id: number;
  task_id: number;
  status: TaskStatus;
  confidence: number | null;
  reason: string | null;
  source_message_id: string | null;
  created_at: string;
}

export interface ReminderHistory {
  id: number;
  user_id: number;
  reminder_type: ReminderType;
  message: string;
  sent_at: string;
}

export interface ExtractedTask {
  task: string;
  status: TaskStatus;
}

export interface ProgressAnalysisResult {
  related_task_id: number | null;
  is_related: boolean;
  progress: TaskStatus;
  confidence: number;
  reason: string;
}

export interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
  };
  channelId: string;
  channelName?: string;
  timestamp: string;
}

export interface EsaPost {
  number: number;
  title: string;
  fullName: string;
  bodyMarkdown: string;
  url: string;
  createdBy: {
    id: string;
    name: string;
  };
}

/**
 * LLMによるタスク操作意図の解析結果
 */
export interface TaskOperationIntent {
  action: 'add_task' | 'complete_task' | 'list_tasks' | 'unknown';
  /** complete_task: 現在のタスク一覧から一意に特定できた場合のタスクID */
  task_id: number | null;
  /** complete_task: 対象タスクの推定タイトル（表示・曖昧確認用） */
  task_title: string | null;
  /** add_task: 追加するタスク名 */
  new_task: string | null;
  /** 判定の確信度 (0.0〜1.0) */
  confidence: number;
}