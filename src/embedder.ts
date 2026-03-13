import { logger } from './logger.js';

type Pipeline = (
  text: string,
  options: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let pipelineInstance: Pipeline | null = null;
let loadFailed = false;

export class Embedder {
  private modelName: string;

  constructor(modelName = 'Xenova/all-MiniLM-L6-v2') {
    this.modelName = modelName;
  }

  get available(): boolean {
    return !loadFailed;
  }

  async embed(text: string): Promise<Float32Array> {
    const pipe = await this.getPipeline();
    const result = await pipe(text, { pooling: 'mean', normalize: true });
    return result.data;
  }

  private async getPipeline(): Promise<Pipeline> {
    if (pipelineInstance) return pipelineInstance;
    if (loadFailed) throw new Error('Embedding model previously failed to load');

    try {
      const { pipeline } = await import('@xenova/transformers');
      pipelineInstance = (await pipeline(
        'feature-extraction',
        this.modelName,
      )) as unknown as Pipeline;
      logger.info({ model: this.modelName }, 'Embedding model loaded');
      return pipelineInstance;
    } catch (err) {
      loadFailed = true;
      logger.warn({ err, model: this.modelName }, 'Failed to load embedding model');
      throw err;
    }
  }
}
