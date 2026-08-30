import { Task } from '../types';

/**
 * タスク配列から「最新の週報」に紐づくものだけを抽出する
 * esaの投稿番号は単調増加するため、esa_post_url末尾の番号が最大のものが最新週報
 */
export function filterLatestReportTasks(tasks: Task[]): Task[] {
  const withUrl = tasks.filter((t) => t.esa_post_url);
  if (withUrl.length === 0) {
    return tasks;
  }
  const postNumber = (url: string): number => Number(url.split('/').pop()) || 0;
  const latestUrl = withUrl.reduce((a, b) =>
    postNumber(a.esa_post_url!) >= postNumber(b.esa_post_url!) ? a : b
  ).esa_post_url!;
  return withUrl.filter((t) => t.esa_post_url === latestUrl);
}
