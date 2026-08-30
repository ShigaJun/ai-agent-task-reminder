import { getJapaneseYearAndWeek } from './japanese-week';

describe('getJapaneseYearAndWeek', () => {
  test('2026-08-30 JST is week 36', () => {
    const timestamp = String(Date.parse('2026-08-30T00:00:00+09:00'));
    expect(getJapaneseYearAndWeek(timestamp)).toEqual({ year: '2026', weekNumber: 36 });
  });

  test('uses the Japanese date around UTC midnight', () => {
    const timestamp = String(Date.parse('2026-01-01T00:30:00+09:00'));
    expect(getJapaneseYearAndWeek(timestamp)).toEqual({ year: '2026', weekNumber: 1 });
  });

  test('rejects an invalid Discord timestamp', () => {
    expect(() => getJapaneseYearAndWeek('invalid')).toThrow('Invalid Discord message timestamp');
  });
});
