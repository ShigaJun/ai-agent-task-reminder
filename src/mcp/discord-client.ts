import { Client, GatewayIntentBits, Events, Partials, TextChannel, Interaction, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { config } from '../config';
import { DiscordMessage } from '../types';

/**
 * Discord APIクライアント
 * Botを通じてDiscordと連携する
 */
export class DiscordClient {
  private client: Client;
  private messageHandlers: ((message: DiscordMessage) => void)[] = [];
  /** インタラクション（ボタン等）ハンドラ */
  private interactionHandlers: ((interaction: Interaction) => void | Promise<void>)[] = [];
  /** timesチャンネルのキャッシュ（名前→チャンネル）。REST往復を避けるため保持する。 */
  private channelCache: Map<string, TextChannel> = new Map();

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
      partials: [Partials.Channel],
    });

    this.setupEventHandlers();
    this.setupChannelCacheInvalidation();
  }

  /**
   * チャンネル作成・削除・更新時にキャッシュを無効化する
   */
  private setupChannelCacheInvalidation(): void {
    this.client.on(Events.ChannelCreate, () => this.channelCache.clear());
    this.client.on(Events.ChannelDelete, () => this.channelCache.clear());
    this.client.on(Events.ChannelUpdate, () => this.channelCache.clear());
  }

  /**
   * 全guildのチャンネルを取得し、timesプレフィックスのテキストチャンネルをキャッシュに格納する
   */
  private async loadTimesChannelsIntoCache(): Promise<void> {
    this.channelCache.clear();
    const prefix = config.discord.timesChannelPrefix;
    for (const guild of this.client.guilds.cache.values()) {
      const channels = await guild.channels.fetch();
      for (const channel of channels.values()) {
        if (
          channel &&
          channel instanceof TextChannel &&
          channel.name.startsWith(prefix)
        ) {
          this.channelCache.set(channel.name, channel);
        }
      }
    }
  }

  /**
   * イベントハンドラの設定
   */
  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, () => {
      console.log(`Discord Bot logged in as ${this.client.user?.tag}`);
    });

    this.client.on(Events.MessageCreate, (message) => {
      // Bot自身のメッセージは無視
      if (message.author.bot) return;

      const discordMessage: DiscordMessage = {
        id: message.id,
        content: message.content,
        author: {
          id: message.author.id,
          username: message.author.username,
        },
        channelId: message.channel.id,
        channelName: 'name' in message.channel ? (message.channel as any).name : undefined,
        timestamp: message.createdTimestamp.toString(),
      };

      // 登録されたハンドラを呼び出す
      this.messageHandlers.forEach((handler) => handler(discordMessage));
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      this.interactionHandlers.forEach((handler) => {
        void Promise.resolve(handler(interaction)).catch((error) => {
          console.error('Interaction handler error:', error);
        });
      });
    });
  }

  /**
   * Discordに接続
   * login()は初期準備(ready)完了を待ってからresolveする
   */
  async connect(): Promise<void> {
    await this.client.login(config.discord.botToken);
  }

  /**
   * 指定チャンネルにメッセージを送信
   * @param channelId チャンネルID
   * @param content メッセージ内容
   */
  async sendMessage(channelId: string, content: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel) {
        throw new Error(`Channel not found: ${channelId}`);
      }
      if (channel instanceof TextChannel) {
        await channel.send(content);
      } else {
        throw new Error(`Channel is not a text channel: ${channelId}`);
      }
    } catch (error) {
      console.error('Discord send message error:', error);
      throw new Error(`Failed to send message to Discord: ${error}`);
    }
  }

  /**
   * timesプレフィックスで始まるチャンネルを取得する（キャッシュ利用）
   * @returns 対象のテキストチャンネル配列
   */
  async getTimesChannels(): Promise<TextChannel[]> {
    return Array.from(this.channelCache.values());
  }

  /**
   * timesチャンネル名一覧を取得する
   * @returns チャンネル名配列（例: ["times-wata_haru"]）
   */
  async getTimesChannelNames(): Promise<string[]> {
    return Array.from(this.channelCache.keys());
  }

  /**
   * チャンネル名（または〇〇部分）からチャンネルを特定する
   * "times-wata_haru" のようにフルネームでも、"wata_haru" のように
   * プレフィックスを除いた形でも指定できる。
   * @param name チャンネル名 or プレフィックスを除いた名前
   */
  async resolveChannelByName(name: string): Promise<TextChannel | null> {
    const prefix = config.discord.timesChannelPrefix;
    const fullName = name.startsWith(prefix) ? name : `${prefix}${name}`;
    return this.channelCache.get(fullName) || null;
  }

  /**
   * timesチャンネルをDiscordから取得してキャッシュを更新する
   * 起動時やキャッシュ再読込み時に呼ぶ
   */
  async refreshTimesChannelCache(): Promise<void> {
    await this.loadTimesChannelsIntoCache();
  }

  /**
   * 指定した名前のtimesチャンネルにメッセージを送信する
   * @param name チャンネル名（"times-wata_haru" or "wata_haru"）
   * @param content メッセージ内容
   * @param components ボタン等のコンポーネント（省略可）
   */
  async sendToTimesChannelByName(
    name: string,
    content: string,
    components?: ActionRowBuilder<ButtonBuilder>[]
  ): Promise<void> {
    const channel = await this.resolveChannelByName(name);
    if (!channel) {
      throw new Error(`Times channel not found by name: ${name}`);
    }
    if (components && components.length > 0) {
      await channel.send({ content, components });
    } else {
      await channel.send(content);
    }
  }

  /**
   * 全てのtimesチャンネルに同じメッセージを送信する
   * @param content メッセージ内容
   */
  async sendToAllTimes(content: string): Promise<void> {
    const channels = await this.getTimesChannels();
    if (channels.length === 0) {
      throw new Error('No times channels found.');
    }
    for (const channel of channels) {
      await channel.send(content);
    }
  }

  /**
   * メッセージ受信ハンドラを登録
   * @param handler メッセージハンドラ
   */
  onMessage(handler: (message: DiscordMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * インタラクション（ボタンクリック等）ハンドラを登録
   * @param handler インタラクションハンドラ
   */
  onInteraction(handler: (interaction: Interaction) => void | Promise<void>): void {
    this.interactionHandlers.push(handler);
  }

  /**
   * BotのユーザーIDを取得する
   */
  getBotId(): string | undefined {
    return this.client.user?.id;
  }

  /**
   * メッセージがBotへのメンションか判定する
   * - 実メンション: <@BOT_ID> / <@!BOT_ID>
   */
  isMentioningMe(content: string): boolean {
    const id = this.client.user?.id;
    return Boolean(id && (content.includes(`<@${id}>`) || content.includes(`<@!${id}>`)));
  }

  /**
   * Botの実メンション部分を本文から取り除く
   */
  stripMention(content: string): string {
    return content.replace(/<@!?\d+>/g, ' ').trim();
  }

  /**
   * 指定チャンネルの最近のメッセージを取得
   * @param channelId チャンネルID
   * @param limit 取得件数
   */
  async getRecentMessages(channelId: string, limit: number = 50): Promise<DiscordMessage[]> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Channel not found or not a text channel: ${channelId}`);
      }

      const messages = await channel.messages.fetch({ limit });
      return messages
        .filter((msg) => !msg.author.bot)
        .map((msg) => ({
          id: msg.id,
          content: msg.content,
          author: {
            id: msg.author.id,
            username: msg.author.username,
          },
          channelId: msg.channel.id,
          timestamp: msg.createdTimestamp.toString(),
        }))
        .reverse(); // 時系列順に並び替え
    } catch (error) {
      console.error('Discord get messages error:', error);
      throw new Error(`Failed to get messages from Discord: ${error}`);
    }
  }

  /**
   * 切断
   */
  async disconnect(): Promise<void> {
    await this.client.destroy();
  }
}
