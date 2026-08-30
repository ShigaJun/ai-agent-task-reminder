import dotenv from 'dotenv';
dotenv.config();

export interface Config {
  esa: {
    apiKey: string;
    teamName: string;
  };
  discord: {
    botToken: string;
    timesChannelPrefix: string;
  };
  llm: {
    apiKey: string;
    model: string;
    confidenceThreshold: number;
  };
  schedule: {
    progressCheck: string;
    weeklyTasks: string;
  };
  database: {
    path: string;
  };
  /** ジョブモード実行後、指定分数で自動終了する（0 = 無効） */
  autoShutdownMinutes: number;
}

export const config: Config = {
  esa: {
    apiKey: process.env.ESA_API_KEY || '',
    teamName: process.env.ESA_TEAM_NAME || '',
  },
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || '',
    timesChannelPrefix: process.env.DISCORD_TIMES_CHANNEL_PREFIX || 'times-',
  },
  llm: {
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gpt-4o',
    confidenceThreshold: parseFloat(process.env.LLM_CONFIDENCE_THRESHOLD || '0.7'),
  },
  schedule: {
    // 金曜日9:00: 今週分のタスクの達成度チェック
    progressCheck: process.env.SCHEDULE_PROGRESS_CHECK || '0 9 * * 5',
    // 金曜日13:00: 週報の「来週やること」を送信
    weeklyTasks: process.env.SCHEDULE_WEEKLY_TASKS || '0 13 * * 5',
  },
  database: {
    path: process.env.DATABASE_PATH || './db/tasks.db',
  },
  autoShutdownMinutes: Number(process.env.AUTO_SHUTDOWN_MINUTES || 0),
};

export const validateConfig = (): void => {
  const required = [
    ['ESA_API_KEY', config.esa.apiKey],
    ['ESA_TEAM_NAME', config.esa.teamName],
    ['DISCORD_BOT_TOKEN', config.discord.botToken],
    ['LLM_API_KEY', config.llm.apiKey],
  ];

  for (const [key, value] of required) {
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
};