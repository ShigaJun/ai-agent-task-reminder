import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { EsaPost } from '../types';

/**
 * esa APIクライアント
 * esaのAPI v1を使用して週報を取得する
 */
export class EsaClient {
  private client: AxiosInstance;
  private teamName: string;
  private weeklyPostsCache: { year: string; posts: EsaPost[]; fetchedAt: number } | null = null;
  private static readonly WEEKLY_CACHE_TTL_MS = 5 * 60 * 1000; // 5分

  constructor() {
    this.teamName = config.esa.teamName;
    this.client = axios.create({
      baseURL: 'https://api.esa.io/v1',
      headers: {
        'Authorization': `Bearer ${config.esa.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

                /**
   * esa APIの投稿レスポンスをEsaPostに変換する
   */
  private toEsaPost(post: any): EsaPost {
    return {
      number: post.number,
      title: post.name,
      fullName: post.full_name || '',
      bodyMarkdown: post.body_md,
      url: post.url,
      createdBy: {
        id: post.created_by?.id || '',
        name: post.created_by?.name || '',
      },
    };
  }

  /**
   * 指定されたカテゴリの最新投稿を取得
   * ※ esa APIの `category` パラメータは信頼できないため検索クエリ(q)を使用する
   * @param category カテゴリ名（例: 週報/2026/34）子カテゴリも含まれる
   * @param limit 取得件数
   * @returns 投稿配列
   */
  async getPostsByCategory(category: string, limit: number = 10): Promise<EsaPost[]> {
    try {
      const response = await this.client.get(`/teams/${this.teamName}/posts`, {
        params: {
          q: `category:${category}`,
          per_page: limit,
          sort: 'updated',
          order: 'desc',
        },
      });

      return response.data.posts.map((post: any) => this.toEsaPost(post));
    } catch (error) {
      console.error('esa API error:', error);
      throw new Error(`Failed to fetch posts from esa: ${error}`);
    }
  }

  /**
   * 日本時間から年と週数を計算する（フォールバック用の簡易計算）
   * @returns { year: string, weekNumber: number }
   */
  private getJapaneseYearAndWeek(): { year: string; weekNumber: number } {
    // 日本時間（JST, UTC+9）で現在の年と週数を取得
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000; // 9時間のミリ秒
    const jstNow = new Date(now.getTime() + jstOffset);

    const year = jstNow.getFullYear().toString();

    // ISO週数計算（簡易版: 1日〜7日を1週目として計算）
    const jan1 = new Date(jstNow.getFullYear(), 0, 1);
    const today = jstNow;
    const dayOfYear = Math.floor(
      (today.getTime() - jan1.getTime()) / (24 * 60 * 60 * 1000)
    ) + 1;
    const weekNumber = Math.ceil(dayOfYear / 7);

    return { year, weekNumber };
  }

  /**
   * esaに存在する週報（週報/<年>/配下）の投稿一覧を取得する
   * - 検索クエリ q=category:週報/<年> を使用（categoryパラメータは信頼できないため）
   * - 件数が多い場合はページングする（最大 maxPages ページ）
   * - 結果はTTL付きでキャッシュし、同一プロセス内の連続呼び出しではAPIを再取得しない
   */
  private async fetchWeeklyPostsOfYear(year: string): Promise<EsaPost[]> {
    const now = Date.now();
    if (
      this.weeklyPostsCache &&
      this.weeklyPostsCache.year === year &&
      now - this.weeklyPostsCache.fetchedAt < EsaClient.WEEKLY_CACHE_TTL_MS
    ) {
      return this.weeklyPostsCache.posts;
    }

    const posts: EsaPost[] = [];
    const perPage = 100;
    const maxPages = 5; // 500件まで（週報の年間投稿数を十分カバー）

    try {
      for (let page = 1; page <= maxPages; page++) {
        const response = await this.client.get(`/teams/${this.teamName}/posts`, {
          params: {
            q: `category:週報/${year}`,
            per_page: perPage,
            page: page,
            sort: 'updated',
            order: 'desc',
          },
        });

        const fetched: EsaPost[] = response.data.posts.map((post: any) =>
          this.toEsaPost(post)
        );
        posts.push(...fetched);

        const totalCount: number = response.data.total_count ?? posts.length;
        if (posts.length >= totalCount || fetched.length < perPage) {
          break;
        }
      }
    } catch (error) {
      console.error('esa API error:', error);
      throw new Error(`Failed to fetch weekly posts from esa: ${error}`);
    }

    this.weeklyPostsCache = { year, posts, fetchedAt: now };
    return posts;
  }

  /**
   * 週報を取得する
   *
   * 「今週」の判定は日付計算ではなく esa の実データに基づく:
   *   対象週 = weekNumber指定があればその週、なければ esa に存在する週報の最大週（チームの最新週）
   *   - ユーザー名指定時: 対象週の <ユーザー名> の週報を返す（無ければ null → 呼び出し側はスキップ）
   *   - ユーザー未指定時: 対象週の週報のうち最初の1件を返す
   *
   * @param year 年（省略時は日本時間の現在の年）
   * @param weekNumber 週数（省略時は esa の最新週）
   * @param userName esaユーザー名
   * @returns 週報投稿（見つからなければ null）
   */
  async getWeeklyReport(year?: string, weekNumber?: number, userName?: string): Promise<EsaPost | null> {
    // 対象年を計算（JST）
    const { year: computedYear } = this.getJapaneseYearAndWeek();
    const targetYear = year || computedYear;

    // esaから週報/<年> 配下の投稿を取得
    const allPosts = await this.fetchWeeklyPostsOfYear(targetYear);

    // 週報/<年>/<週>/<ユーザー名> 形式の投稿を解析
    const parsed = allPosts
      .map((post) => {
        const parts = post.fullName.split('/');
        if (
          parts.length === 4 &&
          parts[0] === '週報' &&
          parts[1] === targetYear &&
          /^\d+$/.test(parts[2])
        ) {
          return { post, week: parseInt(parts[2], 10), user: parts[3] };
        }
        return null;
      })
      .filter((x): x is { post: EsaPost; week: number; user: string } => x !== null);

    if (parsed.length === 0) {
      console.log(`No weekly reports found in esa under 週報/${targetYear}.`);
      return null;
    }

    // 対象週を決定（指定 > チームの最新週）
    const teamMaxWeek = Math.max(...parsed.map((x) => x.week));
    const targetWeek = weekNumber ?? teamMaxWeek;

    if (userName) {
      const target = parsed.find((x) => x.week === targetWeek && x.user === userName);
      if (!target) {
        console.log(`Weekly report not found: 週報/${targetYear}/${targetWeek}/${userName}`);
        return null;
      }
      console.log(`Using weekly report: ${target.post.fullName}`);
      return target.post;
    }

    // ユーザー未指定時はその週の投稿の最初の1件を返す
    const anyPost = parsed.find((x) => x.week === targetWeek);
    console.log(`Using weekly report: ${anyPost!.post.fullName}`);
    return anyPost!.post;
  }

  /**
   * 指定投稿の本文（body_md）を更新する（esa API: PATCH）
   * ※ 部分更新のため、body_md以外のフィールドには影響しない
   * ※ esaにはリビジョン履歴が残るため、誤更新でも差し戻し可能
   * @param postNumber 投稿番号
   * @param bodyMd 更新後の本文
   */
  async updatePostBody(postNumber: number, bodyMd: string): Promise<void> {
    try {
      await this.client.patch(`/teams/${this.teamName}/posts/${postNumber}`, {
        body_md: bodyMd,
      });
    } catch (error) {
      console.error('esa API error:', error);
      throw new Error(`Failed to update esa post: ${error}`);
    }
  }

  /**
   * 指定された番号の投稿を取得
   * @param postNumber 投稿番号
   * @returns 投稿
   */
  async getPost(postNumber: number): Promise<EsaPost | null> {
    try {
      // esa APIの単体取得はレスポンス自体が投稿オブジェクト(r.data が post)
      const response = await this.client.get(`/teams/${this.teamName}/posts/${postNumber}`);
      return this.toEsaPost(response.data);
    } catch (error) {
      console.error('esa API error:', error);
      throw new Error(`Failed to fetch post from esa: ${error}`);
    }
  }
}