# AIエージェントタスク管理・リマインドシステム

## 概要

このシステムは、esaの週報から「来週やること（計画）」セクションを自動取得し、
Discordのtimesチャンネルにリマインド通知を送信し、
ユーザーのDiscord発言からタスクの進捗をLLMで判定・更新するAIエージェントシステムです。

## アーキテクチャ

```
MCP (外部サービス接続)
├── esa-client.ts    - esa APIクライアント
├── discord-client.ts - Discord APIクライアント
├── task-db.ts       - SQLiteタスクDBクライアント
└── llm-client.ts    - LLM APIクライアント

Skills (AI判断ロジック)
├── task-manager.ts       - タスク管理ロジック
├── progress-analyzer.ts  - 進捗判定ロジック (LLM)
└── reminder-generator.ts - リマインド生成ロジック (LLM)

Hooks (イベント・スケジューラ)
├── scheduler.ts          - 定期実行ハンドラ
└── discord-listener.ts   - Discordメッセージリスナー
```

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
# .envファイルを編集して必要な値を設定
```

### 3. 起動

```bash
# 開発モード
npm run dev

# 本番モード
npm run build
npm run start:prod
```

## 機能

### 1. esa週報取得
- 毎週月曜日、esaから「来週やること（計画）」セクションを取得
- Markdownチェックボックスからタスクを抽出

### 2. Discord times通知
- 取得したタスクをDiscord timesチャンネルに通知

### 3. LLM進捗判定
- Discordの投稿をLLMで解析し、タスクとの関連性を判定
- 進捗状態（todo/in_progress/completed）を推定
- 信頼度スコアによる誤判定防止

### 4. 定期リマインド
- 月曜日: 今週のタスク通知
- 水曜日: 進捗確認
- 金曜日: 未完了タスク催促

## データベーススキーマ

- `users`: ユーザー情報
- `tasks`: タスク情報
- `task_progress_history`: タスク進捗履歴
- `reminder_history`: リマインド履歴

## 開発

### ビルド

```bash
npm run build
```

### テスト

```bash
# マークダウンパーサーのテスト
npx ts-node -e "
const { MarkdownParser } = require('./src/utils/markdown-parser');
const md = \`# 来週やること（計画）

- [ ] ゼミ制作（ヘッダーを追加）
- [ ] ゼミチームミーティング
\`;
console.log(JSON.stringify(MarkdownParser.extractTasks(md), null, 2));
"