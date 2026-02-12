import { createClient, type RemoveBackgroundClient } from './client';
import type {
	BatchProcessOptions,
	ClientConfig,
	LoadOptions,
	RemoveBackgroundInput,
	RemoveOptions,
	RemoveResult,
	WorkerClientOptions,
	WorkerExecutionMode,
	WorkerRequest,
	WorkerResponse
} from './types';

type WorkerSafeInput = Exclude<RemoveBackgroundInput, HTMLImageElement | HTMLCanvasElement>;

function supportsWorkerMode(): boolean {
	return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

function isWorkerSafeInput(input: RemoveBackgroundInput): input is WorkerSafeInput {
	if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) return false;
	if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) return false;
	return true;
}

function toHtmlCanvas(bitmap: ImageBitmap, width: number, height: number): HTMLCanvasElement {
	if (typeof document === 'undefined') {
		throw new Error('Worker client requires a DOM-capable environment for HTMLCanvasElement output.');
	}
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not create output canvas context.');
	ctx.drawImage(bitmap, 0, 0);
	return canvas;
}

class WorkerBackedClient implements RemoveBackgroundClient {
	private readonly worker: Worker;
	private readonly fallbackClient: RemoveBackgroundClient;
	private requestCounter = 0;

	constructor(worker: Worker, config?: ClientConfig) {
		this.worker = worker;
		this.fallbackClient = createClient(config);
	}

	private nextRequestId(): string {
		this.requestCounter += 1;
		return `worker-${this.requestCounter}`;
	}

	private postRequest(request: WorkerRequest, transfer: Transferable[] = []): Promise<WorkerResponse> {
		return new Promise((resolve, reject) => {
			const onMessage = (event: MessageEvent<WorkerResponse>) => {
				if (!event.data || event.data.requestId !== request.requestId) return;
				this.worker.removeEventListener('message', onMessage as EventListener);
				if (!event.data.ok) {
					reject(new Error(event.data.error ?? 'Worker request failed.'));
					return;
				}
				resolve(event.data);
			};
			this.worker.addEventListener('message', onMessage as EventListener);
			this.worker.postMessage(request, transfer);
		});
	}

	async load(options?: LoadOptions): Promise<void> {
		const requestId = this.nextRequestId();
		await this.postRequest({ requestId, type: 'load', options });
	}

	async remove(input: RemoveBackgroundInput, options?: RemoveOptions): Promise<RemoveResult> {
		if (!isWorkerSafeInput(input)) {
			return await this.fallbackClient.remove(input, options);
		}
		const requestId = this.nextRequestId();
		const transfer = typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap ? [input] : [];
		const response = await this.postRequest({ requestId, type: 'remove', input, options }, transfer);
		if (!response.result) {
			throw new Error('Worker remove response missing result payload.');
		}
		const canvas = toHtmlCanvas(response.result.bitmap, response.result.width, response.result.height);
		return { canvas, width: response.result.width, height: response.result.height };
	}

	async removeMany(
		inputs: RemoveBackgroundInput[],
		options?: RemoveOptions,
		batchOptions?: BatchProcessOptions
	): Promise<RemoveResult[]> {
		const workerSafeInputs = inputs.filter(isWorkerSafeInput);
		const canUseWorker = workerSafeInputs.length === inputs.length;
		if (!canUseWorker) {
			return await this.fallbackClient.removeMany(inputs, options, batchOptions);
		}
		const requestId = this.nextRequestId();
		const transfer = workerSafeInputs.filter(
			(value): value is ImageBitmap => typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap
		);
		const response = await this.postRequest(
			{
				requestId,
				type: 'removeMany',
				inputs: workerSafeInputs,
				options,
				batchOptions
			},
			transfer
		);
		return (response.results ?? []).map((item) => ({
			canvas: toHtmlCanvas(item.bitmap, item.width, item.height),
			width: item.width,
			height: item.height
		}));
	}

	getLoadedModelLabel(): string | null {
		// Keep synchronous shape by delegating to fallback state.
		return this.fallbackClient.getLoadedModelLabel();
	}

	dispose(): void {
		const requestId = this.nextRequestId();
		void this.postRequest({ requestId, type: 'dispose' }).catch(() => undefined);
		this.worker.terminate();
		this.fallbackClient.dispose();
	}
}

function shouldUseWorker(mode: WorkerExecutionMode): boolean {
	return mode === 'worker' || mode === 'auto';
}

export function createWorkerClient(options?: WorkerClientOptions): RemoveBackgroundClient {
	const mode = options?.mode ?? 'auto';
	const wantsWorker = shouldUseWorker(mode);
	const supported = supportsWorkerMode();
	if (!wantsWorker || !supported || !options?.workerFactory) {
		return createClient(options?.config);
	}

	const worker = options.workerFactory();
	return new WorkerBackedClient(worker, options.config);
}
