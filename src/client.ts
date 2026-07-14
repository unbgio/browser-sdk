import { resolveClientConfig } from './config';
import type { Processor, PreTrainedModel } from '@huggingface/transformers';

import { ClientDisposedError } from './errors';
import { disposeModelBundle, loadModelBundle } from './model';
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
	dispose(): Promise<void>;
}

class RemoveBackgroundClientImpl implements RemoveBackgroundClient {
	private model: PreTrainedModel | null = null;
	private processor: Processor | null = null;
	private loadedLabel: string | null = null;
	private loadingPromise: Promise<void> | null = null;
	private disposePromise: Promise<void> | null = null;
	private readonly inFlightOperations = new Set<Promise<unknown>>();
	private state: 'active' | 'disposing' | 'disposed' = 'active';
	private generation = 0;
	private readonly config: ClientConfig;

	constructor(config?: ClientConfig) {
		this.config = resolveClientConfig(config);
	}

	private assertActive(): void {
		if (this.state !== 'active') {
			throw new ClientDisposedError('This background-removal client has been disposed.');
		}
	}

	private runOperation<T>(operation: () => Promise<T>): Promise<T> {
		this.assertActive();
		const promise = operation();
		this.inFlightOperations.add(promise);
		void promise.finally(() => this.inFlightOperations.delete(promise)).catch(() => undefined);
		return promise;
	}

	async load(options?: LoadOptions): Promise<void> {
		this.assertActive();
		if (this.model && this.processor) return;
		if (this.loadingPromise) return this.loadingPromise;

		this.config.hooks?.telemetry?.({ type: 'load:start', timestamp: Date.now() });
		const startedAt = Date.now();
		const generation = this.generation;
		const loadAttempt = (async () => {
			const loaded = await loadModelBundle(this.config, options?.onProgress);
			if (this.state !== 'active' || generation !== this.generation) {
				await disposeModelBundle(loaded);
				throw new ClientDisposedError('The client was disposed while its model was loading.');
			}
			this.model = loaded.model;
			this.processor = loaded.processor;
			this.loadedLabel = loaded.label;
		})();
		this.loadingPromise = loadAttempt;

		try {
			await loadAttempt;
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
			if (this.loadingPromise === loadAttempt) this.loadingPromise = null;
		}
	}

	private async removeWithTelemetry(
		input: RemoveBackgroundInput,
		options?: RemoveOptions,
		loaded?: { model: PreTrainedModel; processor: Processor }
	): Promise<RemoveResult> {
		this.config.hooks?.telemetry?.({ type: 'remove:start', timestamp: Date.now() });
		const startedAt = Date.now();
		try {
			if (!loaded) await this.load();
			const model = loaded?.model ?? this.model;
			const processor = loaded?.processor ?? this.processor;
			if (!model || !processor) {
				throw new Error('Model is not loaded.');
			}
			const result = await removeBackgroundWithModel(model, processor, this.config, input, options);
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

	remove(input: RemoveBackgroundInput, options?: RemoveOptions): Promise<RemoveResult> {
		return this.runOperation(() => this.removeWithTelemetry(input, options));
	}

	removeMany(
		inputs: RemoveBackgroundInput[],
		options?: RemoveOptions,
		batchOptions?: BatchProcessOptions
	): Promise<RemoveResult[]> {
		return this.runOperation(async () => {
			this.config.hooks?.telemetry?.({ type: 'removeMany:start', timestamp: Date.now() });
			const startedAt = Date.now();

			try {
				const maxBatchSize = this.config.performance?.maxBatchSize ?? 100;
				if (inputs.length > maxBatchSize) {
					throw new RangeError(
						`Batch contains ${inputs.length} inputs; the configured limit is ${maxBatchSize}.`
					);
				}
				const requestedConcurrency = batchOptions?.concurrency ?? 1;
				if (!Number.isSafeInteger(requestedConcurrency) || requestedConcurrency <= 0) {
					throw new TypeError('batchOptions.concurrency must be a positive safe integer.');
				}
				await this.load();
				if (!this.model || !this.processor) throw new Error('Model is not loaded.');
				const loaded = { model: this.model, processor: this.processor };
				const concurrency = Math.min(requestedConcurrency, Math.max(1, inputs.length));
				const results: RemoveResult[] = new Array(inputs.length);
				let cursor = 0;
				const batchFailures: unknown[] = [];

				const worker = async (): Promise<void> => {
					while (batchFailures.length === 0) {
						const index = cursor++;
						if (index >= inputs.length) return;
						try {
							results[index] = await this.removeWithTelemetry(inputs[index], options, loaded);
						} catch (error) {
							if (batchFailures.length === 0) batchFailures.push(error);
						}
					}
				};

				await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
				if (batchFailures.length > 0) throw batchFailures[0];
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
		});
	}

	getLoadedModelLabel(): string | null {
		return this.loadedLabel;
	}

	dispose(): Promise<void> {
		if (this.disposePromise) return this.disposePromise;
		if (this.state === 'disposed') return Promise.resolve();

		this.state = 'disposing';
		this.generation += 1;
		const model = this.model;
		const processor = this.processor;
		const label = this.loadedLabel;
		const loadingPromise = this.loadingPromise;
		const operations = [...this.inFlightOperations];
		this.model = null;
		this.processor = null;
		this.loadedLabel = null;

		this.disposePromise = (async () => {
			try {
				await Promise.allSettled(operations);
				if (loadingPromise) await loadingPromise.catch(() => undefined);
				if (model && processor) await disposeModelBundle({ model, processor, label });
			} finally {
				this.loadingPromise = null;
				this.state = 'disposed';
			}
		})();
		return this.disposePromise;
	}
}

export function createClient(config?: ClientConfig): RemoveBackgroundClient {
	return new RemoveBackgroundClientImpl(config);
}
