import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { Task, User, TaskProgressHistory, ReminderHistory, TaskStatus, ReminderType } from '../types';

export class TaskDbClient {
  private db: Database | null = null;

  async initialize(): Promise<void> {
    const dbPath = config.database.path;
    const dbDir = path.dirname(dbPath);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    // スキーマの初期化
    const schemaPath = path.join(__dirname, '../../db/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await this.db.exec(schema);

    // マイグレーション: 旧カラム名(discord_times_channel_id)からの移行
    await this.migrateUserChannelColumn();
  }

  /**
   * 旧スキーマの discord_times_channel_id カラムを
   * discord_times_channel_name に移行する。
   * 旧値はチャンネルIDであり名前と不整合になるため、ユーザーデータは作り直す。
   */
  private async migrateUserChannelColumn(): Promise<void> {
    const db = this.getDb();
    const columns = await db.all<{ name: string }[]>('PRAGMA table_info(users)');
    const hasOld = columns.some((c) => c.name === 'discord_times_channel_id');
    const hasNew = columns.some((c) => c.name === 'discord_times_channel_name');

    if (hasOld && !hasNew) {
      console.log('Migrating users table: discord_times_channel_id -> discord_times_channel_name');
      await db.exec(
        'ALTER TABLE users RENAME COLUMN discord_times_channel_id TO discord_times_channel_name'
      );
      // 旧データ(チャンネルID)は名前と不整合のため削除して再登録させる
      await db.exec('DELETE FROM users');
    }
  }

  private getDb(): Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  // ユーザー関連
  async createUser(userData: {
    esa_user_id: string;
    discord_user_id: string;
    discord_times_channel_name: string;
  }): Promise<User> {
    const db = this.getDb();
    const result = await db.run(
      'INSERT INTO users (esa_user_id, discord_user_id, discord_times_channel_name) VALUES (?, ?, ?)',
      userData.esa_user_id,
      userData.discord_user_id,
      userData.discord_times_channel_name
    );
    return this.getUserById(result.lastID!);
  }

  async getUserByDiscordId(discordUserId: string): Promise<User | null> {
    const db = this.getDb();
    const user = await db.get<User>('SELECT * FROM users WHERE discord_user_id = ?', discordUserId);
    return user || null;
  }

  async getUserByChannelName(channelName: string): Promise<User | null> {
    const db = this.getDb();
    const user = await db.get<User>(
      'SELECT * FROM users WHERE discord_times_channel_name = ?',
      channelName
    );
    return user || null;
  }

  async getAllUsers(): Promise<User[]> {
    const db = this.getDb();
    return db.all<User[]>('SELECT * FROM users');
  }

  async getUserById(id: number): Promise<User> {
    const db = this.getDb();
    const user = await db.get<User>('SELECT * FROM users WHERE id = ?', id);
    if (!user) {
      throw new Error(`User not found: ${id}`);
    }
    return user;
  }

  // タスク関連
  async createTask(taskData: {
    userId: number;
    taskText: string;
    status: TaskStatus;
    esaPostUrl?: string;
  }): Promise<Task> {
    const db = this.getDb();
    const result = await db.run(
      'INSERT INTO tasks (user_id, task_text, status, esa_post_url) VALUES (?, ?, ?, ?)',
      taskData.userId,
      taskData.taskText,
      taskData.status,
      taskData.esaPostUrl || null
    );
    return this.getTaskById(result.lastID!);
  }

  async getTaskById(id: number): Promise<Task> {
    const db = this.getDb();
    const task = await db.get<Task>('SELECT * FROM tasks WHERE id = ?', id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    return task;
  }

  /**
   * 同一ユーザー・同一テキストのタスクを検索する（重複登録防止用）
   */
  async findTaskByUserIdAndText(userId: number, taskText: string): Promise<Task | null> {
    const db = this.getDb();
    const task = await db.get<Task>(
      'SELECT * FROM tasks WHERE user_id = ? AND task_text = ? ORDER BY id DESC LIMIT 1',
      userId,
      taskText
    );
    return task || null;
  }

  /**
   * タスクの紐づく週報URLを更新する
   */
  async updateTaskEsaPostUrl(taskId: number, esaPostUrl: string): Promise<Task> {
    const db = this.getDb();
    await db.run(
      'UPDATE tasks SET esa_post_url = ?, updated_at = ? WHERE id = ?',
      esaPostUrl,
      new Date().toISOString(),
      taskId
    );
    return this.getTaskById(taskId);
  }

  async getTasks(userId: number, options?: { status?: TaskStatus }): Promise<Task[]> {
    const db = this.getDb();
    if (options?.status) {
      return db.all<Task[]>('SELECT * FROM tasks WHERE user_id = ? AND status = ?', userId, options.status);
    }
    return db.all<Task[]>('SELECT * FROM tasks WHERE user_id = ?', userId);
  }

  async updateTaskStatus(
    taskId: number,
    status: TaskStatus,
    metadata?: {
      confidence?: number;
      reason?: string;
      sourceMessageId?: string;
    }
  ): Promise<Task> {
    const db = this.getDb();
    const now = new Date().toISOString();

    await db.run(
      'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?',
      status,
      now,
      taskId
    );

    // 進捗履歴を記録
    if (metadata) {
      await db.run(
        'INSERT INTO task_progress_history (task_id, status, confidence, reason, source_message_id) VALUES (?, ?, ?, ?, ?)',
        taskId,
        status,
        metadata.confidence || null,
        metadata.reason || null,
        metadata.sourceMessageId || null
      );
    }

    return this.getTaskById(taskId);
  }

  // 進捗履歴関連
  async getTaskProgressHistory(taskId: number): Promise<TaskProgressHistory[]> {
    const db = this.getDb();
    return db.all<TaskProgressHistory[]>(
      'SELECT * FROM task_progress_history WHERE task_id = ? ORDER BY created_at DESC',
      taskId
    );
  }

  // リマインド履歴関連
  async createReminderHistory(data: {
    userId: number;
    reminderType: ReminderType;
    message: string;
  }): Promise<ReminderHistory> {
    const db = this.getDb();
    const result = await db.run(
      'INSERT INTO reminder_history (user_id, reminder_type, message) VALUES (?, ?, ?)',
      data.userId,
      data.reminderType,
      data.message
    );
    return this.getReminderHistoryById(result.lastID!);
  }

  async getReminderHistoryById(id: number): Promise<ReminderHistory> {
    const db = this.getDb();
    const history = await db.get<ReminderHistory>('SELECT * FROM reminder_history WHERE id = ?', id);
    if (!history) {
      throw new Error(`Reminder history not found: ${id}`);
    }
    return history;
  }

  async getRecentReminderCount(userId: number, type: ReminderType, days: number = 7): Promise<number> {
    const db = this.getDb();
    const result = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM reminder_history WHERE user_id = ? AND reminder_type = ? AND sent_at > datetime("now", "-" || ? || " days")',
      userId,
      type,
      days
    );
    return result?.count || 0;
  }

  /**
   * タスクを削除する（関連する進捗履歴も削除する）
   * ※ 主にテストのクリーンアップ用
   */
  async deleteTask(taskId: number): Promise<void> {
    const db = this.getDb();
    await db.run('DELETE FROM task_progress_history WHERE task_id = ?', taskId);
    await db.run('DELETE FROM tasks WHERE id = ?', taskId);
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}