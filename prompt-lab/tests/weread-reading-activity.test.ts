import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatReadingDuration, loadReadingActivities, saveReadingActivity, type WereadReadingActivity } from '../src/plugins/weread/readingActivity';

function activity(bookId: string, lastReadAt: number): WereadReadingActivity {
  return { bookId, lastReadAt, url: `https://weread.qq.com/web/reader/${bookId}`, title: bookId, coverUrl: '', chapter: '', progress: 0, totalSeconds: 0, dailySeconds: {} };
}

describe('WeRead reading activity', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  it('updates a book without creating duplicates and sorts by recent time', () => {
    saveReadingActivity(activity('book-a', 1));
    saveReadingActivity(activity('book-b', 2));
    saveReadingActivity({ ...activity('book-a', 3), totalSeconds: 60 });
    expect(loadReadingActivities().map((item) => item.bookId)).toEqual(['book-a', 'book-b']);
    expect(loadReadingActivities()[0].totalSeconds).toBe(60);
  });

  it('keeps at most thirty recent books', () => {
    for (let index = 0; index < 35; index += 1) saveReadingActivity(activity(`book-${index}`, index));
    expect(loadReadingActivities()).toHaveLength(30);
    expect(loadReadingActivities()[0].bookId).toBe('book-34');
  });

  it('formats short and long durations for the UI', () => {
    expect(formatReadingDuration(45)).toBe('45 秒');
    expect(formatReadingDuration(125)).toBe('2 分钟');
    expect(formatReadingDuration(3_900)).toBe('1 小时 5 分钟');
  });
});
