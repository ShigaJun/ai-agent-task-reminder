import { config, validateConfig } from "./config";
import { TaskDbClient } from "./mcp/task-db";
import { EsaClient } from "./mcp/esa-client";
import { DiscordClient } from "./mcp/discord-client";
import { LlmClient } from "./mcp/llm-client";
import { TaskManager } from "./skills/task-manager";
import { ProgressAnalyzer } from "./skills/progress-analyzer";
import { SchedulerHook } from "./hooks/scheduler";
import { DiscordListenerHook } from "./hooks/discord-listener";
import { ChecklistInteractionHook } from "./hooks/checklist-interaction";
import { MentionHandlerHook } from "./hooks/mention-handler";
import { TaskOperationAnalyzer } from "./skills/task-operation-analyzer";
import { TaskOperator } from "./skills/task-operator";
import { postToTimes } from "./utils/times-poster";

/**
 * AIエージェントタスク管理・リマインドシステム
 * メインエントリーポイント
 */
class AiAgentTaskReminder {
  private taskDb: TaskDbClient;
  private esaClient: EsaClient;
  private discordClient: DiscordClient;
  private llmClient: LlmClient;
  private taskManager: TaskManager;
  private progressAnalyzer: ProgressAnalyzer;
  private schedulerHook: SchedulerHook;
  private discordListenerHook: DiscordListenerHook;
  private checklistInteractionHook: ChecklistInteractionHook;
  private mentionHandlerHook: MentionHandlerHook;
  private taskOperationAnalyzer: TaskOperationAnalyzer;
  private taskOperator: TaskOperator;

  constructor() {
    // MCP (外部サービス接続)
    this.taskDb = new TaskDbClient();
    this.esaClient = new EsaClient();
    this.discordClient = new DiscordClient();
    this.llmClient = new LlmClient();

    // Skills (AI判断ロジック)
    this.taskManager = new TaskManager(this.taskDb, this.esaClient);
    this.progressAnalyzer = new ProgressAnalyzer(this.llmClient);
    this.taskOperationAnalyzer = new TaskOperationAnalyzer(this.llmClient);
    this.taskOperator = new TaskOperator(
      this.taskDb,
      this.esaClient,
      this.taskOperationAnalyzer,
    );

    // Hooks (イベント・スケジューラ)
    this.schedulerHook = new SchedulerHook(
      this.taskDb,
      this.discordClient,
      this.taskManager,
    );
    this.discordListenerHook = new DiscordListenerHook(
      this.discordClient,
      this.taskDb,
      this.progressAnalyzer,
      this.taskManager,
    );
    this.checklistInteractionHook = new ChecklistInteractionHook(
      this.discordClient,
      this.taskDb,
    );
    this.mentionHandlerHook = new MentionHandlerHook(
      this.discordClient,
      this.taskDb,
      this.schedulerHook,
      this.taskOperator,
    );
  }

  async start(): Promise<void> {
    console.log("Starting AI Agent Task Reminder...");

    // 設定検証
    validateConfig();

    // collect important job messages to post at the end
    const jobMessages: string[] = [];

    try {
      // DB初期化
      await this.taskDb.initialize();
      console.log("Database initialized.");
      jobMessages.push("Database initialized.");

      // Discord接続
      await this.discordClient.connect();
      console.log("Discord connected.");
      jobMessages.push("Discord connected.");

      // timesチャンネルのキャッシュを事前読み込み
      await this.discordClient.refreshTimesChannelCache();
      jobMessages.push("Times channel cache refreshed.");

      // ユーザー登録
      await this.ensureUserExists();

      // ジョブモード: 指定ジョブを即時実行（cronは起動しない。二重投稿防止）
      // 通常モード: cronスケジューラーを開始
      const job = this.getJobArg();
      if (job) {
        console.log(`Job mode: ${job}`);
        jobMessages.push(`Job mode: ${job}`);
        if (job === "progress-check") {
          await this.schedulerHook.handleProgressCheck();
          jobMessages.push("progress-check handled");
        } else if (job === "weekly-tasks") {
          await this.schedulerHook.handleWeeklyTasksPost();
          jobMessages.push("weekly-tasks handled");
        } else {
          console.warn(
            `Unknown job: ${job} (available: progress-check, weekly-tasks)`,
          );
          jobMessages.push(`Unknown job: ${job}`);
        }
      } else {
        this.schedulerHook.start();
      }

      // Discordリスナー開始
      this.discordListenerHook.start();

      // チェックリストボタンのクリック処理を開始
      this.checklistInteractionHook.start();

      // メンションコマンド処理を開始
      this.mentionHandlerHook.start();

      // 自動終了タイマー
      // - AUTO_SHUTDOWN_MINUTESで指定（0 = 無効）
      // - ジョブモードでは未指定なら10分後に終了（ボタン操作の猶予時間）
      const autoShutdownMinutes =
        config.autoShutdownMinutes > 0
          ? config.autoShutdownMinutes
          : job
            ? 10
            : 0;
      if (autoShutdownMinutes > 0) {
        console.log(`Auto shutdown in ${autoShutdownMinutes} minutes.`);
        setTimeout(
          () => {
            console.log("Auto shutdown triggered.");
            void this.stop()
              .catch((error) => console.error("Error during shutdown:", error))
              .finally(() => process.exit(0));
          },
          autoShutdownMinutes * 60 * 1000,
        );
      }

      console.log("AI Agent Task Reminder started successfully!");
      console.log("Listening for Discord messages and scheduled tasks...");

      // If we ran a job, post aggregated summary to times channels
      const jobArg = this.getJobArg();
      if (jobArg) {
        const summary = `Job ${jobArg} finished.\n\n` + jobMessages.join("\n");
        try {
          await postToTimes(this.discordClient, summary);
        } catch (e) {
          console.error("Failed to post job summary to times channels:", e);
        }
      }
    } catch (error) {
      console.error("Startup error:", error);
      // best-effort: post error summary
      try {
        const summary =
          `Startup error: ${error}` + "\n" + jobMessages.join("\n");
        await postToTimes(this.discordClient, summary).catch(() => undefined);
      } catch (_) {
        // ignore
      }
      throw error;
    }
  }

  /**
   * コマンドライン引数からジョブモードを取得する
   * 例: node dist/index.js --job=weekly-tasks
   */
  private getJobArg(): string | undefined {
    const match = process.argv
      .map((a) => a.match(/^--job=(.+)$/))
      .find(Boolean);
    return match?.[1];
  }

  /**
   * timesチャンネルを全て検出し、ユーザーが存在しない場合は登録する
   */
  private async ensureUserExists(): Promise<void> {
    const channelNames = await this.discordClient.getTimesChannelNames();
    if (channelNames.length === 0) {
      console.log("No times channels found. Skipping user registration.");
      return;
    }

    console.log(`Found times channels: ${channelNames.join(", ")}`);

    for (const channelName of channelNames) {
      const user = await this.taskDb.getUserByChannelName(channelName);
      if (!user) {
        console.log(`Creating user for times channel: ${channelName}`);
        await this.taskDb.createUser({
          esa_user_id: config.esa.teamName, // MVP: チーム名をesa_user_idとして使用
          discord_user_id: channelName, // チャンネル名をユーザー識別子として使用
          discord_times_channel_name: channelName,
        });
        console.log(`User created for ${channelName}.`);
      }
    }
  }

  async stop(): Promise<void> {
    console.log("Stopping AI Agent Task Reminder...");
    this.schedulerHook.stop();
    await this.discordClient.disconnect();
    await this.taskDb.close();
    console.log("AI Agent Task Reminder stopped.");
  }
}

// メイン実行
const agent = new AiAgentTaskReminder();

// グレースフルシャットダウン
process.on("SIGINT", async () => {
  console.log("\nReceived SIGINT. Shutting down gracefully...");
  await agent.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nReceived SIGTERM. Shutting down gracefully...");
  await agent.stop();
  process.exit(0);
});

// 起動
agent.start().catch((error) => {
  console.error("Failed to start AI Agent Task Reminder:", error);
  process.exit(1);
});
