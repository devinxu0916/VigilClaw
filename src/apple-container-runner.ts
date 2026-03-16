import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import type { DockerConfig } from './config.js';
import type { CredentialProxy } from './credential-proxy.js';
import type { IRunner } from './runner-types.js';
import type { QueuedTask, TaskResult } from './types.js';
import { prepareIpcDir, writeTaskInput, readTaskResult, cleanupIpcDir } from './ipc.js';
import { validateMountPath } from './mount-security.js';

const execFile = promisify(execFileCb);
const logger = pino({ name: 'apple-container-runner' });

const CONTAINER_CLI = 'container';

export class AppleContainerRunner implements IRunner {
  constructor(
    private config: DockerConfig,
    private credentialProxy: CredentialProxy,
    private dataDir: string,
  ) {}

  async ping(): Promise<boolean> {
    try {
      const { stdout } = await execFile(CONTAINER_CLI, ['system', 'info'], {
        timeout: 5000,
      });
      return stdout.length > 0;
    } catch {
      return false;
    }
  }

  async runTask(task: QueuedTask): Promise<TaskResult> {
    const ipcDir = prepareIpcDir(this.dataDir, task.id);

    const proxyPort = await this.credentialProxy.createProxyForTask(
      task.id,
      task.provider || 'anthropic',
    );
    const proxyUrl = `http://host.container.internal:${proxyPort}`;

    writeTaskInput(ipcDir, {
      taskId: task.id,
      userId: task.userId,
      groupId: task.groupId,
      messages: task.messages,
      provider: task.provider || 'claude',
      model: task.model,
      maxTokens: 4096,
      tools: task.tools,
      skills: task.skills,
    });

    const containerName = `vigilclaw-${task.id.slice(0, 12)}`;

    const args = this.buildRunArgs(containerName, task, ipcDir, proxyUrl);

    try {
      await execFile(CONTAINER_CLI, args, { timeout: 10000 });

      logger.info({ taskId: task.id, container: containerName, proxyPort }, 'Container started');

      const result = await this.waitForResult(
        task.id,
        containerName,
        ipcDir,
        this.config.taskTimeout,
      );

      return result;
    } catch (err) {
      const logs = await this.getLogs(containerName);
      logger.error(
        { err, taskId: task.id, container: containerName, logs: logs.slice(-1000) },
        'Container task failed',
      );

      return {
        taskId: task.id,
        success: false,
        response: {
          content: `Agent error: ${err instanceof Error ? err.message : String(err)}`,
          usage: { inputTokens: 0, outputTokens: 0 },
          model: task.model,
        },
      };
    } finally {
      await this.cleanup(containerName);
      this.credentialProxy.destroyProxyForTask(task.id).catch(() => {});
      cleanupIpcDir(ipcDir);
    }
  }

  async drainAll(timeoutMs: number): Promise<void> {
    try {
      const { stdout } = await execFile(CONTAINER_CLI, ['ls', '--format', 'json'], {
        timeout: 5000,
      });

      if (!stdout.trim()) return;

      let containers: Array<{ name: string }> = [];
      try {
        containers = JSON.parse(stdout) as Array<{ name: string }>;
      } catch {
        return;
      }

      const vigilclawContainers = containers.filter((c) => c.name?.startsWith('vigilclaw-'));

      const timeoutSec = Math.ceil(timeoutMs / 1000);
      const stopPromises = vigilclawContainers.map((c) =>
        execFile(CONTAINER_CLI, ['stop', c.name, '-t', String(timeoutSec)], {
          timeout: timeoutMs + 5000,
        }).catch((err) => {
          logger.warn({ err, container: c.name }, 'Failed to stop container');
        }),
      );

      await Promise.allSettled(stopPromises);
    } catch (err) {
      logger.warn({ err }, 'Failed to drain Apple containers');
    }
  }

  private buildRunArgs(name: string, task: QueuedTask, ipcDir: string, proxyUrl: string): string[] {
    const memoryMB = Math.floor(this.config.memoryLimit / (1024 * 1024));
    const cpus = this.config.cpuQuota / this.config.cpuPeriod;

    const args = [
      'run',
      '--detach',
      '--name',
      name,
      '--read-only',
      '--memory',
      `${memoryMB}m`,
      '--cpus',
      String(cpus),
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=100m',
      '--env',
      `TASK_ID=${task.id}`,
      '--env',
      `CREDENTIAL_PROXY_URL=${proxyUrl}`,
      '--volume',
      `${ipcDir}:/ipc:rw`,
    ];

    if (task.workspaceDir) {
      validateMountPath(task.workspaceDir);
      args.push('--volume', `${task.workspaceDir}:/workspace:rw`);
    }

    if (task.skills && task.skills.length > 0) {
      const skillsDir = path.join(process.env.HOME ?? '~', '.config', 'vigilclaw', 'skills');
      if (fs.existsSync(skillsDir)) {
        args.push('--volume', `${skillsDir}:/skills:ro`);
      }
    }

    args.push(this.config.appleImage, 'node', '/app/index.js');

    return args;
  }

  private async waitForResult(
    taskId: string,
    containerName: string,
    ipcDir: string,
    timeoutMs: number,
  ): Promise<TaskResult> {
    const resultPath = path.join(ipcDir, 'output', `result-${taskId}.json`);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          this.stopContainer(containerName).catch(() => {});
          reject(new Error(`Task timeout after ${timeoutMs}ms`));
          return;
        }

        if (fs.existsSync(resultPath)) {
          clearInterval(checkInterval);
          const result = readTaskResult(ipcDir, taskId);
          if (result) {
            resolve(result);
          } else {
            reject(new Error('Failed to read task result'));
          }
        }
      }, 200);
    });
  }

  private async getLogs(containerName: string): Promise<string> {
    try {
      const { stdout } = await execFile(CONTAINER_CLI, ['logs', containerName], {
        timeout: 5000,
      });
      return stdout;
    } catch {
      return '';
    }
  }

  private async stopContainer(containerName: string): Promise<void> {
    try {
      await execFile(CONTAINER_CLI, ['stop', containerName, '-t', '3'], {
        timeout: 10000,
      });
    } catch {}
  }

  private async cleanup(containerName: string): Promise<void> {
    try {
      await this.stopContainer(containerName);
      await execFile(CONTAINER_CLI, ['rm', containerName], { timeout: 5000 });
    } catch (err) {
      logger.debug({ err, container: containerName }, 'Cleanup failed');
    }
  }
}
