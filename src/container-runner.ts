import Docker from 'dockerode';
import path from 'node:path';
import fs from 'node:fs';
import pino from 'pino';
import type { DockerConfig } from './config.js';
import type { CredentialProxy } from './credential-proxy.js';
import { CommandBridge } from './command-bridge.js';
import { SearchBridge } from './search-bridge.js';
import { generateWebSearchStubJs } from './skills/web-search-stub.js';
import type { QueuedTask, TaskResult } from './types.js';
import { validateMountPath } from './mount-security.js';
import {
  prepareIpcDir,
  writeTaskInput,
  waitForResult,
  readTaskResult,
  cleanupIpcDir,
} from './ipc.js';

import type { IRunner } from './runner-types.js';

const logger = pino({ name: 'container-runner' });

export class ContainerRunner implements IRunner {
  private docker: Docker;

  constructor(
    private config: DockerConfig,
    private credentialProxy: CredentialProxy,
    private dataDir: string,
    private commandBridge?: CommandBridge,
    private searchBridge?: SearchBridge,
  ) {
    this.docker = new Docker({ socketPath: config.socketPath });
  }

  setCommandBridge(bridge: CommandBridge): void {
    this.commandBridge = bridge;
  }

  setSearchBridge(bridge: SearchBridge): void {
    this.searchBridge = bridge;
  }

  async runTask(task: QueuedTask): Promise<TaskResult> {
    const ipcDir = prepareIpcDir(this.dataDir, task.id);

    const proxyPort = await this.credentialProxy.createProxyForTask(
      task.id,
      task.provider || 'anthropic',
    );
    const proxyUrl = `http://host.docker.internal:${proxyPort}`;

    // Start CommandBridge and generate system-commands stub
    let bridgePort: number | undefined;
    let stubDir: string | undefined;
    if (this.commandBridge) {
      bridgePort = await this.commandBridge.createBridgeForTask(
        task.id,
        task.userId,
        task.groupId,
      );
      stubDir = path.join(ipcDir, 'system-commands-stub');
      fs.mkdirSync(stubDir, { recursive: true });
      fs.writeFileSync(
        path.join(stubDir, 'index.js'),
        CommandBridge.generateStubJs(task.id, task.userId, task.groupId),
        'utf-8',
      );
    }

    // Start SearchBridge and generate web-search stub (if skill is requested)
    const hasWebSearch = task.skills?.some((s) => s.name === 'web-search') ?? false;
    let searchBridgePort: number | undefined;
    let webSearchStubDir: string | undefined;
    if (this.searchBridge && hasWebSearch) {
      searchBridgePort = await this.searchBridge.createBridgeForTask(task.id);
      webSearchStubDir = path.join(ipcDir, 'web-search-stub');
      fs.mkdirSync(webSearchStubDir, { recursive: true });
      fs.writeFileSync(
        path.join(webSearchStubDir, 'index.js'),
        generateWebSearchStubJs(),
        'utf-8',
      );
    }

    // Rewrite codePaths to container-internal IPC paths.
    // Avoids separate bind mounts and conflicts with the read-only rootfs.
    writeTaskInput(ipcDir, {
      taskId: task.id,
      userId: task.userId,
      groupId: task.groupId,
      messages: task.messages,
      provider: task.provider || 'claude',
      model: task.model,
      maxTokens: 4096,
      tools: task.tools,
      skills: task.skills?.map((s) => {
        if (s.name === 'system-commands' && stubDir) {
          return { ...s, codePath: '/ipc/system-commands-stub' };
        }
        if (s.name === 'web-search' && webSearchStubDir) {
          return { ...s, codePath: '/ipc/web-search-stub' };
        }
        return s;
      }),
    });

    const containerName = `vigilclaw-${task.id.slice(0, 12)}`;

    const binds = [`${ipcDir}:/ipc:rw`];
    if (task.workspaceDir) {
      validateMountPath(task.workspaceDir);
      binds.push(`${task.workspaceDir}:/workspace:rw`);
    }

    // Mount user skills dir (if any non-built-in skills exist)
    const hasUserSkills = task.skills?.some((s) => s.codePath !== 'built-in') ?? false;
    if (hasUserSkills) {
      const skillsDir = path.join(process.env.HOME ?? '~', '.config', 'vigilclaw', 'skills');
      if (fs.existsSync(skillsDir)) {
        binds.push(`${skillsDir}:/skills:ro`);
      }
    }

    const env = [`TASK_ID=${task.id}`, `CREDENTIAL_PROXY_URL=${proxyUrl}`];
    if (bridgePort !== undefined) {
      env.push(`COMMAND_BRIDGE_URL=http://host.docker.internal:${bridgePort}`);
    }
    if (searchBridgePort !== undefined) {
      env.push(`SEARCH_BRIDGE_URL=http://host.docker.internal:${searchBridgePort}`);
    }

    let container: Docker.Container | undefined;

    try {
      container = await this.docker.createContainer({
        name: containerName,
        Image: this.config.image,
        Cmd: ['node', '/app/index.js'],
        Env: env,
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

      const waitPromise = container.wait() as Promise<{ StatusCode: number }>;
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
      if (this.commandBridge) {
        await this.commandBridge.destroyBridgeForTask(task.id);
      }
      if (this.searchBridge && hasWebSearch) {
        await this.searchBridge.destroyBridgeForTask(task.id);
      }
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
