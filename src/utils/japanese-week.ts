export interface JapaneseWeek {
  year: string;
  weekNumber: number;
}

/**
 * Discordの投稿時刻をJSTに変換し、esa週報の年・週番号を返す。
 * 週は日曜始まりで、1月1日を含む週を第1週とする。
 */
export function getJapaneseYearAndWeek(timestamp: string): JapaneseWeek {
  const milliseconds = Number(timestamp);
  const instant = new Date(milliseconds);
  if (!Number.isFinite(milliseconds) || Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid Discord message timestamp: ${timestamp}`);
  }

  const jst = new Date(instant.getTime() + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  const startOfYear = Date.UTC(year, 0, 1);
  const currentDate = Date.UTC(year, jst.getUTCMonth(), jst.getUTCDate());
  const dayOfYear = Math.floor((currentDate - startOfYear) / 86_400_000);
  const januaryFirstDay = new Date(startOfYear).getUTCDay();
  const weekNumber = Math.floor((dayOfYear + januaryFirstDay) / 7) + 1;

  return { year: String(year), weekNumber };
}
