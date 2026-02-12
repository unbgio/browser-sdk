import { resolveClientConfig } from './config';
import type { Processor, PreTrainedModel } from '@huggingface/transformers';

import { configureTransformerRuntime, loadModelBundle } from './model';
import { removeBackgroundWithModel } from './pipeline';
import type {
	BatchProcessOptions,
	ClientConfig,
	LoadOptions,
	RemoveBackgroundInput,
	RemoveOptions,
	RemoveResult
} from './types';

export interface RemoveBackgroundClient {
	load(options?: LoadOptions): Promise<void>;
	remove(input: RemoveBackgroundInput, options?: RemoveOptions): Promise<RemoveResult>;
	removeMany(
		inputs: RemoveBackgroundInput[],
		options?: RemoveOptions,
		batchOptions?: BatchProcessOptions
	): Promise<RemoveResult[]>;
	getLoadedModelLabel(): string | null;
	dispose(): void;
}

class RemoveBackgroundClientImpl implements RemoveBackgroundClient {
	private model: PreTrainedModel | null = null;
	private processor: Processor | null = null;
	private loadedLabel: string | null = null;
	private loadingPromise: Promise<void> | null = null;
	private readonly config: ClientConfig;

	constructor(config?: ClientConfig) {
		this.config = resolveClientConfig(config);
		configureTransformerRuntime(this.config);
	}

	async load(options?: LoadOptions): Promise<void> {
		if (this.model && this.processor) return;
		if (this.loadingPromise) return this.loadingPromise;

		this.config.hooks?.telemetry?.({ type: 'load:start', timestamp: Date.now() });
		const startedAt = Date.now();
		this.loadingPromise = (async () => {
			const loaded = await loadModelBundle(this.config, options?.onProgress);
			this.model = loaded.model;
			this.processor = loaded.processor;
			this.loadedLabel = loaded.label;
		})();

		try {
			await this.loadingPromise;
			this.config.hooks?.telemetry?.({
				type: 'load:success',
				timestamp: Date.now(),
				durationMs: Date.now() - startedAt
			});
		} catch (error) {
			this.config.hooks?.telemetry?.({
				type: 'load:error',
				timestamp: Date.now(),
				durationMs: Date.now() - startedAt,
				detail: error instanceof Error ? error.message : 'unknown load error'
			});
			throw error;
		} finally {
			this.loadingPromise = null;
		}
	}

	async remove(input: RemoveBackgroundInput, options?: RemoveOptions): Promise<RemoveResult> {
		this.config.hooks?.telemetry?.({ type: 'remove:start', timestamp: Date.now() });
		const startedAt = Date.now();
		await this.load();
		if (!this.model || !this.processor) {
			throw new Error('Model is not loaded.');
		}
		try {
			const result = await removeBackgroundWithModel(this.model, this.processor, this.config, input, options);
			this.config.hooks?.telemetry?.({
				type: 'remove:success',
				timestamp: Date.now(),
				durationMs: Date.now() - startedAt
			});
			return result;
		} catch (error) {
			this.config.hooks?.telemetry?.({
				type: 'remove:error',
				timestamp: Date.now(),
				durationMs: Date.now() - startedAt,
				detail: error instanceof Error ? error.message : 'unknown remove error'
			});
			throw error;
		}
	}

	async removeMany(
		inputs: RemoveBackgroundInput[],
		options?: RemoveOptions,
		batchOptions?: BatchProcessOptions
	): Promise<RemoveResult[]> {
		this.config.hooks?.telemetry?.({ type: 'removeMany:start', timestamp: Date.now() });
		const startedAt = Date.now();
		const concurrency = Math.max(1, Math.floor(batchOptions?.concurrency ?? 1));
		const results: RemoveResult[] = new Array(inputs.length);
		let cursor = 0;

		const worker = async (): Promise<void> => {
			while (true) {
				const index = cursor++;
				if (index >= inputs.length) return;
				results[index] = await this.remove(inputs[index], options);
			}
		};

		try {
			await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
			this.config.hooks?.telemetry?.({
				type: 'removeMany:success',
				timestamp: Date.now(),
				durationMs: Date.now() - startedAt
			});
			return results;
		} catch (error) {
			this.config.hooks?.telemetry?.({
				type: 'removeMany:error',
				timestamp: Date.now(),
				durationMs: Date.now() - startedAt,
				detail: error instanceof Error ? error.message : 'unknown batch error'
			});
			throw error;
		}
	}

	getLoadedModelLabel(): string | null {
		return this.loadedLabel;
	}

	dispose(): void {
		this.model = null;
		this.processor = null;
		this.loadedLabel = null;
		this.loadingPromise = null;
	}
}

export function createClient(config?: ClientConfig): RemoveBackgroundClient {
	return new RemoveBackgroundClientImpl(config);
}
