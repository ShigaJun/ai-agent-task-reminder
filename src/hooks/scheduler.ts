import * as cron from 'node-cron';
import { config } from '../config';
import { TaskDbClient } from '../mcp/task-db';
import { DiscordClient } from '../mcp/discord-client';
import { TaskManager } from '../skills/task-manager';
import { buildChecklistMessage } from '../skills/checklist-builder';
import { filterLatestReportTasks } from '../utils/task-utils';
import { User } from '../types';

/**
 * スケジューラーフック
 * 金曜日9:00の達成度チェックと13:00の週次タスク送信を実行する
 */
export class SchedulerHook {
  private taskDb: TaskDbClient;
  private discordClient: DiscordClient;
  private taskManager: TaskManager;
  private jobs: cron.ScheduledTask[] = [];

  constructor(taskDb: TaskDbClient, discordClient: DiscordClient, taskManager: TaskManager) {
    this.taskDb = taskDb;
    this.discordClient = discordClient;
    this.taskManager = taskManager;
  }

  /**
   * スケジュールを開始
   * ※ ジョブモード(--job=)で起動した場合は呼ばない（二重投稿防止）
   */
  start(): void {
    // 金曜日9:00: 今週分のタスクの達成度チェック
    const progressCheckJob = cron.schedule(config.schedule.progressCheck, () => {
      this.handleProgressCheck();
    });
    this.jobs.push(progressCheckJob);

    // 金曜日13:00: 週報の「来週やること」を送信
    const weeklyTasksJob = cron.schedule(config.schedule.weeklyTasks, () => {
      this.handleWeeklyTasksPost();
    });
    this.jobs.push(weeklyTasksJob);

    console.log('Scheduler started with jobs:', {
      progressCheck: config.schedule.progressCheck,
      weeklyTasks: config.schedule.weeklyTasks,
    });
  }

  /**
   * 金曜日9:00: 今週分のタスクの達成度チェック
   * esaの最新週報をDBへ同期してから、ボタン付きチェックリストで通知する
   */
  async handleProgressCheck(): Promise<void> {
    try {
      console.log('Running progress check...');

      const users = await this.taskDb.getAllUsers();
      if (users.length === 0) {
        console.log('No users found.');
        return;
      }

      for (const user of users) {
        await this.sendProgressCheck(user);
      }
    } catch (error) {
      console.error('Progress check failed:', error);
    }
  }

  /**
   * 1ユーザー分の達成度チェックを送信する
   * （定期スケジュール実行・メンション実行の共通処理）
   */
  async sendProgressCheck(user: User): Promise<void> {
    try {
      await this.taskManager.fetchAndSaveWeeklyTasks(user.id);
      const allTasks = await this.taskDb.getTasks(user.id);
      const tasks = filterLatestReportTasks(allTasks);

      if (tasks.length === 0) {
        const message = 'まだ今週分のタスクがありません。金曜13:00に週報から取得します 👀';
        await this.discordClient.sendToTimesChannelByName(user.discord_times_channel_name, message);
        console.log(`No tasks for ${user.discord_times_channel_name}.`);
        return;
      }

      const { content, components } = buildChecklistMessage(
        tasks,
        '📋 **今週のタスク達成度チェック**'
      );
      await this.discordClient.sendToTimesChannelByName(
        user.discord_times_channel_name,
        content,
        components
      );

      await this.taskDb.createReminderHistory({
        userId: user.id,
        reminderType: 'progress-check',
        message: content,
      });

      console.log(`Progress check sent to #${user.discord_times_channel_name}.`);
    } catch (error) {
      console.error(`Progress check failed for ${user.discord_times_channel_name}:`, error);
    }
  }

  /**
   * 金曜日13:00: esaの最新週報から「来週やること」を取得して送信
   * ※ 週報は金曜11:30以降に書かれるため、13:00時点で最新週報を取得する
   */
  async handleWeeklyTasksPost(): Promise<void> {
    try {
      console.log('Running weekly tasks post...');

      const users = await this.taskDb.getAllUsers();
      if (users.length === 0) {
        console.log('No users found.');
        return;
      }

      // 金曜13:00は前週までのタスク・履歴を初期化してから最新週報を同期する
      await this.taskDb.resetTaskData();
      console.log('Task data reset before weekly tasks sync.');

      for (const user of users) {
        await this.sendWeeklyTasks(user);
      }
    } catch (error) {
      console.error('Weekly tasks post failed:', error);
    }
  }

  /**
   * 1ユーザー分の「来週やること」をesaから取得して送信する
   * （定期スケジュール実行・メンション実行の共通処理）
   */
  async sendWeeklyTasks(user: User): Promise<void> {
    try {
      const tasks = await this.taskManager.fetchAndSaveWeeklyTasks(user.id);

      if (tasks.length === 0) {
        const message = '今週の週報が見つかりませんでした。👀';
        await this.discordClient.sendToTimesChannelByName(user.discord_times_channel_name, message);
        await this.taskDb.createReminderHistory({
          userId: user.id,
          reminderType: 'weekly-tasks',
          message,
        });
        return;
      }

      const { content, components } = buildChecklistMessage(tasks);
      await this.discordClient.sendToTimesChannelByName(
        user.discord_times_channel_name,
        content,
        components
      );

      await this.taskDb.createReminderHistory({
        userId: user.id,
        reminderType: 'weekly-tasks',
        message: content,
      });

      console.log(`Posted ${tasks.length} weekly tasks to #${user.discord_times_channel_name}.`);
    } catch (error) {
      console.error(`Weekly tasks post failed for ${user.discord_times_channel_name}:`, error);
    }
  }

  /**
   * スケジュールを停止
   */
  stop(): void {
    this.jobs.forEach((job) => job.stop());
    this.jobs = [];
    console.log('Scheduler stopped.');
  }
}
