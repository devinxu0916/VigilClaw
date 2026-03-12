import fs from 'node:fs';
import path from 'node:path';
import { reactLoop } from './react-loop.js';
import type { TaskInput, TaskResult } from './types.js';

const IPC_INPUT_DIR = '/ipc/input';
const IPC_OUTPUT_DIR = '/ipc/output';

function readTaskInput(taskId: string): TaskInput {
  const filePath = path.join(IPC_INPUT_DIR, `task-${taskId}.json`);
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as TaskInput;
}

function writeTaskResult(taskId: string, result: TaskResult): void {
  const filePath = path.join(IPC_OUTPUT_DIR, `result-${taskId}.json`);
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(result));
  fs.renameSync(tempPath, filePath);
}

async function main(): Promise<void> {
  const taskId = process.env.TASK_ID;
  if (!taskId) {
    process.stderr.write('TASK_ID environment variable is required\n');
    process.exit(1);
  }

  try {
    const taskInput = readTaskInput(taskId);
    const result = await reactLoop(taskInput);
    writeTaskResult(taskId, result);
    process.exit(0);
  } catch (err) {
    const errorResult: TaskResult = {
      taskId,
      success: false,
      response: {
        content: `Agent error: ${err instanceof Error ? err.message : String(err)}`,
        usage: { inputTokens: 0, outputTokens: 0 },
        model: 'unknown',
      },
    };
    writeTaskResult(taskId, errorResult);
    process.exit(1);
  }
}

main();
