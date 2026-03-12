import Docker from 'dockerode';
import path from 'node:path';
import pino from 'pino';
import type { DockerConfig } from './config.js';
import type { CredentialProxy } from './credential-proxy.js';
import type { QueuedTask, TaskResult } from './types.js';
import { validateMountPath } from './mount-security.js';
import {
  prepareIpcDir,
  writeTaskInput,
  waitForResult,
  readTaskResult,
  cleanupIpcDir,
} from './ipc.js';

const logger = pino({ name: 'container-runner' });

export class ContainerRunner {
  private docker: Docker;

  constructor(
    private config: DockerConfig,
    private credentialProxy: CredentialProxy,
    private dataDir: string,
  ) {
    this.docker = new Docker({ socketPath: config.socketPath });
  }

  async runTask(task: QueuedTask): Promise<TaskResult> {
    const ipcDir = prepareIpcDir(this.dataDir, task.id);

    const proxyPort = await this.credentialProxy.createProxyForTask(task.id, 'anthropic');
    const proxyUrl = `http://host.docker.internal:${proxyPort}`;

    writeTaskInput(ipcDir, {
      taskId: task.id,
      userId: task.userId,
      groupId: task.groupId,
      messages: task.messages,
      model: task.model,
      maxTokens: 4096,
      tools: task.tools,
    });

    const containerName = `vigilclaw-${task.id.slice(0, 12)}`;

    const binds = [`${ipcDir}:/ipc:rw`];
    if (task.workspaceDir) {
      validateMountPath(task.workspaceDir);
      binds.push(`${task.workspaceDir}:/workspace:rw`);
    }

    let container: Docker.Container | undefined;

    try {
      container = await this.docker.createContainer({
        name: containerName,
        Image: this.config.image,
        Cmd: ['node', '/app/index.js'],
        Env: [`TASK_ID=${task.id}`, `CREDENTIAL_PROXY_URL=${proxyUrl}`],
        HostConfig: {
          AutoRemove: false,
          ReadonlyRootfs: true,
          SecurityOpt: ['no-new-privileges:true'],
          CapDrop: ['ALL'],
          Memory: this.config.memoryLimit,
          CpuQuota: this.config.cpuQuota,
          CpuPeriod: this.config.cpuPeriod,
          PidsLimit: this.config.pidsLimit,
          Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=100m' },
          Binds: binds,
        },
      });

      await container.start();
      logger.info({ taskId: task.id, container: containerName, proxyPort }, 'Container started');

      const waitPromise = container.wait();
      const resultPromise = waitForResult(ipcDir, task.id, this.config.taskTimeout);

      const result = await Promise.race([
        resultPromise,
        waitPromise.then(async (waitResult) => {
          const logs = await container!.logs({ stdout: true, stderr: true });
          const logStr = logs.toString().slice(-2000);
          logger.info(
            { taskId: task.id, exitCode: waitResult.StatusCode, logs: logStr },
            'Container exited',
          );

          if (waitResult.StatusCode !== 0) {
            throw new Error(
              `Container exited with code ${waitResult.StatusCode}: ${logStr.slice(-500)}`,
            );
          }

          const ipcResult = readTaskResult(ipcDir, task.id);
          if (ipcResult) return ipcResult;
          throw new Error(`Container exited but no result file. Logs: ${logStr.slice(-500)}`);
        }),
      ]);

      return result;
    } catch (err) {
      if (container) {
        try {
          const logs = await container.logs({ stdout: true, stderr: true });
          logger.error({ taskId: task.id, logs: logs.toString().slice(-1000) }, 'Container failed');
        } catch {}
        try {
          await container.stop({ t: 3 });
        } catch {}
        try {
          await container.remove({ force: true });
        } catch {}
      }
      throw err;
    } finally {
      if (container) {
        try {
          await container.remove({ force: true });
        } catch {}
      }
      await this.credentialProxy.destroyProxyForTask(task.id);
      cleanupIpcDir(ipcDir);
    }
  }

  async drainAll(timeoutMs: number): Promise<void> {
    try {
      const containers = await this.docker.listContainers({
        filters: { name: ['vigilclaw-'] },
      });
      await Promise.allSettled(
        containers.map((c) => {
          const ctr = this.docker.getContainer(c.Id);
          return ctr.stop({ t: Math.floor(timeoutMs / 1000) });
        }),
      );
    } catch (err) {
      logger.error({ err }, 'Error draining containers');
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }
}
