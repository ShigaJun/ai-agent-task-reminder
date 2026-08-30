import { MarkdownParser } from '../utils/markdown-parser';

/**
 * MarkdownParserのテスト
 */
describe('MarkdownParser', () => {
  describe('extractTasks', () => {
    it('should extract tasks from "来週やること（計画）" section', () => {
      const markdown = `# 来週やること（計画）

- [ ] ゼミ合宿
- [ ] まどマギの映画観に行く
`;
      const tasks = MarkdownParser.extractTasks(markdown);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].task).toBe('ゼミ合宿');
      expect(tasks[0].status).toBe('todo');
      expect(tasks[1].task).toBe('まどマギの映画観に行く');
      expect(tasks[1].status).toBe('todo');
    });

    it('should extract completed tasks', () => {
      const markdown = `# 来週やること（計画）

- [x] ゼミ合宿
- [ ] まどマギの映画観に行く
`;
      const tasks = MarkdownParser.extractTasks(markdown);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].status).toBe('completed');
      expect(tasks[1].status).toBe('todo');
    });

    it('should handle asterisk checkboxes', () => {
      const markdown = `# 来週やること（計画）

* [ ] タスク1
* [ ] タスク2
`;
      const tasks = MarkdownParser.extractTasks(markdown);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].task).toBe('タスク1');
      expect(tasks[1].task).toBe('タスク2');
    });

    it('should return empty array when no tasks found', () => {
      const markdown = `# 週報

何もないです。
`;
      const tasks = MarkdownParser.extractTasks(markdown);
      expect(tasks).toHaveLength(0);
    });
  });
});

describe('MarkdownParser.removeTaskCheckbox', () => {
  test('来週やることから指定した行だけを削除する', () => {
    const markdown = [
      '## 来週やること',
      '- [ ] ゼミ制作',
      '- [x] 資料提出',
      '',
      '## 今週やったこと',
      '- [ ] ゼミ制作',
    ].join('\n');

    const result = MarkdownParser.removeTaskCheckbox(markdown, 'ゼミ制作');
    expect(result).not.toContain('## 来週やること\n- [ ] ゼミ制作');
    expect(result).toContain('- [x] 資料提出');
    expect(result).toContain('## 今週やったこと\n- [ ] ゼミ制作');
  });

  test('対象行がなければnullを返す', () => {
    expect(MarkdownParser.removeTaskCheckbox('## 来週やること\n- [ ] 資料提出', 'ゼミ制作')).toBeNull();
  });
});
