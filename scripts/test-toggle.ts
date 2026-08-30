import 'dotenv/config';
import { TaskDbClient } from '../src/mcp/task-db';
import { EsaClient } from '../src/mcp/esa-client';
import { ChecklistInteractionHook } from '../src/hooks/checklist-interaction';
import { buildChecklistContent } from '../src/skills/checklist-builder';

/**
 * テスト用: チェックリストボタンのトグル処理(handleToggle)を擬似インタラクションで実行する
 * 実行: npx ts-node scripts/test-toggle.ts [タスクID]
 * 2回実行するため、実行後もタスクの状態は元に戻る
 */
async function main(): Promise<void> {
  const taskDb = new TaskDbClient();
  await taskDb.initialize();
  const hook = new ChecklistInteractionHook({} as any, taskDb, new EsaClient());

  const taskId = Number(process.argv[2] || '18');
  const before = await taskDb.getTaskById(taskId);
  const originalContent = buildChecklistContent([before]);

  let captured: any = null;
  const fakeInteraction: any = {
    customId: `task-toggle:${taskId}`,
    isButton: () => true,
    deferUpdate: async () => {},
    editReply: async (payload: any) => {
      captured = payload;
    },
    message: { id: 'test-message', content: originalContent },
    deferred: false,
    replied: false,
    reply: async () => {},
  };

  // 1回目: todo -> completed
  await (hook as any).handleToggle(fakeInteraction);
  const after = await taskDb.getTaskById(taskId);
  console.log('=== toggle once ===');
  console.log(`status: ${before.status} -> ${after.status}`);
  console.log('content:', JSON.stringify(captured?.content));
  const rows = (captured?.components ?? []).map((r: any) =>
    (r.toJSON ? r.toJSON() : r).components.map((b: any) => ({
      label: b.label,
      style: b.style,
      custom_id: b.custom_id,
    }))
  );
  console.log('components:', JSON.stringify(rows, null, 2));

  // 2回目: completed -> todo（元に戻す）
  await (hook as any).handleToggle(fakeInteraction);
  const reverted = await taskDb.getTaskById(taskId);
  console.log('=== toggle twice (revert) ===');
  console.log(`status: ${after.status} -> ${reverted.status}`);

  await taskDb.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
