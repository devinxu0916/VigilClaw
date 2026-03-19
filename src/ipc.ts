import fs from 'node:fs';
import path from 'node:path';
import type { TaskInput, TaskResult } from './types.js';

export function prepareIpcDir(dataDir: string, taskId: string): string {
  const ipcDir = path.resolve(dataDir, 'ipc', taskId);
  fs.mkdirSync(path.join(ipcDir, 'input'), { recursive: true });
  fs.mkdirSync(path.join(ipcDir, 'output'), { recursive: true });
  return ipcDir;
}

export function writeTaskInput(ipcDir: string, input: TaskInput): void {
  const filePath = path.join(ipcDir, 'input', `task-${input.taskId}.json`);
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(input));
  fs.renameSync(tempPath, filePath);
}

export function readTaskResult(ipcDir: string, taskId: string): TaskResult | null {
  const filePath = path.join(ipcDir, 'output', `result-${taskId}.json`);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as TaskResult;
}

export function waitForResult(
  ipcDir: string,
  taskId: string,
  timeoutMs: number,
): Promise<TaskResult> {
  return new Promise((resolve, reject) => {
    const outputDir = path.join(ipcDir, 'output');
    const expectedFile = `result-${taskId}.json`;

    const timeout = setTimeout(() => {
      watcher.close();
      reject(new Error(`Task ${taskId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const watcher = fs.watch(outputDir, (_, filename) => {
      if (filename !== expectedFile) return;

      clearTimeout(timeout);
      watcher.close();

      try {
        const result = readTaskResult(ipcDir, taskId);
        if (result) {
          resolve(result);
        } else {
          reject(new Error(`Failed to read result for task ${taskId}`));
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    const existing = readTaskResult(ipcDir, taskId);
    if (existing) {
      clearTimeout(timeout);
      watcher.close();
      resolve(existing);
    }
  });
}

export function writeInjectMessage(
  ipcDir: string,
  message: { role: string; content: string },
): void {
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const filePath = path.join(ipcDir, 'input', `${timestamp}-${rand}.json`);
  const data = { type: 'inject_message', message };
  fs.writeFileSync(filePath, JSON.stringify(data));
}

export function cleanupIpcDir(ipcDir: string): void {
  try {
    fs.rmSync(ipcDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}
