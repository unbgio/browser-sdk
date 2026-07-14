import { createClient, type RemoveBackgroundClient } from './client';
import { resolveClientConfig } from './config';
import {
	DEFAULT_MAX_INPUT_PIXELS,
	DEFAULT_WORKER_DISPOSE_TIMEOUT_MS,
	DEFAULT_WORKER_REQUEST_TIMEOUT_MS
} from './constants';
import { ClientDisposedError } from './errors';
import type {
	BatchProcessOptions,
	ClientConfig,
	LoadOptions,
	ModelLoadProgress,
	RemoveBackgroundInput,
	RemoveOptions,
	RemoveResult,
	WorkerClientOptions,
	WorkerExecutionMode,
	WorkerMessage,
	WorkerRequest,
	WorkerResponse,
	WorkerRuntimeConfig
} from './types';

type WorkerSafeInput = Exclude<RemoveBackgroundInput, HTMLImageElement | HTMLCanvasElement>;

interface PendingRequest {
	resolve: (response: WorkerResponse) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	requestType: WorkerRequest['type'];
	expectedResults?: number;
	onProgress?: (progress: ModelLoadProgress) => void;
	removeAbortListener?: () => void;
}

interface PostRequestOptions {
	timeoutMs?: number;
	expectedResults?: number;
	onProgress?: (progress: ModelLoadProgress) => void;
	signal?: AbortSignal;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateTimeout(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
		throw new TypeError(`${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}.`);
	}
}

function supportsWorkerMode(): boolean {
	return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

function isWorkerSafeInput(input: RemoveBackgroundInput): input is WorkerSafeInput {
	if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) return false;
	if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) return false;
	return true;
}

function toWorkerRuntimeConfig(config?: ClientConfig): WorkerRuntimeConfig | undefined {
	if (!config) return undefined;
	const { hooks: _hooks, ...workerConfig } = config;
	return workerConfig;
}

function withoutSignal(options?: RemoveOptions): Omit<RemoveOptions, 'signal'> | undefined {
	if (!options) return undefined;
	const { signal: _signal, ...workerOptions } = options;
	return workerOptions;
}

function abortError(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	return new DOMException('The operation was aborted.', 'AbortError');
}

function closeBitmap(bitmap: ImageBitmap | undefined): void {
	try {
		bitmap?.close();
	} catch {
		// Cleanup must not obscure the request that produced the bitmap.
	}
}

function closeResponseBitmaps(response: WorkerResponse): void {
	closeUnknownResponseBitmaps(response);
}

function closeUnknownResponseBitmaps(value: unknown): void {
	if (!isRecord(value)) return;
	const closePayload = (payload: unknown): void => {
		if (!isRecord(payload)) return;
		const bitmap = payload.bitmap;
		if (isRecord(bitmap) && typeof bitmap.close === 'function') {
			closeBitmap(bitmap as unknown as ImageBitmap);
		}
	};
	closePayload(value.result);
	if (Array.isArray(value.results)) value.results.forEach(closePayload);
}

function validateResponseShape(message: Record<string, unknown>): boolean {
	return (
		typeof message.ok === 'boolean' &&
		(message.error === undefined || typeof message.error === 'string') &&
		(message.label === undefined || message.label === null || typeof message.label === 'string') &&
		(message.result === undefined || isRecord(message.result)) &&
		(message.results === undefined ||
			(Array.isArray(message.results) && message.results.every(isRecord)))
	);
}

function getResponseProtocolError(
	pending: PendingRequest,
	message: WorkerResponse
): string | null {
	if (pending.requestType === 'remove') {
		return message.result && message.results === undefined
			? null
			: 'Worker remove response has an invalid result payload.';
	}
	if (pending.requestType === 'removeMany') {
		return message.result === undefined &&
			message.results !== undefined &&
			message.results.length === pending.expectedResults
			? null
			: 'Worker removeMany response has an invalid result payload.';
	}
	return message.result === undefined && message.results === undefined
		? null
		: `Worker ${pending.requestType} response included an unexpected image payload.`;
}

function toHtmlCanvas(
	bitmap: ImageBitmap,
	width: number,
	height: number,
	maxOutputPixels: number
): HTMLCanvasElement {
	try {
		if (
			!bitmap ||
			typeof bitmap.close !== 'function' ||
			!Number.isSafeInteger(width) ||
			!Number.isSafeInteger(height) ||
			width <= 0 ||
			height <= 0 ||
			!Number.isSafeInteger(width * height) ||
			width * height > maxOutputPixels
		) {
			throw new Error('Worker returned an invalid or oversized image payload.');
		}
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
	} finally {
		closeBitmap(bitmap);
	}
}

class WorkerBackedClient implements RemoveBackgroundClient {
	private readonly worker: Worker;
	private readonly fallbackClient: RemoveBackgroundClient;
	private readonly requestTimeoutMs: number;
	private readonly maxOutputPixels: number;
	private readonly pendingRequests = new Map<string, PendingRequest>();
	private readonly initializationPromise: Promise<WorkerResponse>;
	private requestCounter = 0;
	private workerLabel: string | null = null;
	private state: 'active' | 'disposing' | 'disposed' = 'active';
	private disposePromise: Promise<void> | null = null;

	constructor(worker: Worker, config?: ClientConfig, requestTimeoutMs = DEFAULT_WORKER_REQUEST_TIMEOUT_MS) {
		validateTimeout(requestTimeoutMs, 'requestTimeoutMs');
		const resolvedConfig = resolveClientConfig(config);
		this.worker = worker;
		this.requestTimeoutMs = requestTimeoutMs;
		this.maxOutputPixels = resolvedConfig.performance?.maxInputPixels ?? DEFAULT_MAX_INPUT_PIXELS;
		this.fallbackClient = createClient(config);
		this.worker.addEventListener('message', this.onMessage as EventListener);
		this.worker.addEventListener('error', this.onError as EventListener);
		this.worker.addEventListener('messageerror', this.onMessageError as EventListener);
		this.initializationPromise = this.postRequest({
			requestId: this.nextRequestId(),
			type: 'initialize',
			config: toWorkerRuntimeConfig(config)
		});
		void this.initializationPromise.catch((error: unknown) => {
			this.failWorker(error instanceof Error ? error : new Error('Worker initialization failed.'));
		});
	}

	private readonly onMessage = (event: MessageEvent<WorkerMessage>): void => {
		const message = event.data;
		if (
			!isRecord(message) ||
			typeof message.requestId !== 'string' ||
			!['progress', 'response'].includes(String(message.type))
		) {
			closeUnknownResponseBitmaps(message);
			this.failWorker(new Error('The background-removal worker returned an invalid protocol message.'));
			return;
		}
		const pending = this.pendingRequests.get(message.requestId);
		if (message.type === 'progress') {
			if (!isRecord(message.progress) || typeof message.progress.status !== 'string') {
				closeUnknownResponseBitmaps(message);
				this.failWorker(new Error('The background-removal worker returned invalid progress data.'));
				return;
			}
			if (pending?.onProgress) {
				try {
					pending.onProgress(message.progress);
				} catch {
					// Progress observers must not break the RPC lifecycle.
				}
			}
			return;
		}
		if (!validateResponseShape(message)) {
			closeUnknownResponseBitmaps(message);
			this.failWorker(new Error('The background-removal worker returned an invalid response.'));
			return;
		}
		if (!pending) {
			closeResponseBitmaps(message);
			return;
		}
		this.clearPending(message.requestId, pending);
		if (!message.ok) {
			closeResponseBitmaps(message);
			pending.reject(new Error(message.error ?? 'Worker request failed.'));
			return;
		}
		const protocolError = getResponseProtocolError(pending, message);
		if (protocolError) {
			closeResponseBitmaps(message);
			pending.reject(new Error(protocolError));
			return;
		}
		pending.resolve(message);
	};

	private readonly onError = (event: ErrorEvent): void => {
		this.failWorker(new Error(event.message || 'The background-removal worker failed.'));
	};

	private readonly onMessageError = (): void => {
		this.failWorker(new Error('The background-removal worker returned an unreadable message.'));
	};

	private assertActive(): void {
		if (this.state !== 'active') {
			throw new ClientDisposedError('This background-removal worker client has been disposed.');
		}
	}

	private nextRequestId(): string {
		this.requestCounter += 1;
		return `worker-${this.requestCounter}`;
	}

	private clearPending(requestId: string, pending: PendingRequest): void {
		this.pendingRequests.delete(requestId);
		clearTimeout(pending.timer);
		pending.removeAbortListener?.();
	}

	private rejectAllPending(error: Error): void {
		for (const [requestId, pending] of this.pendingRequests) {
			this.clearPending(requestId, pending);
			pending.reject(error);
		}
	}

	private removeWorkerListeners(): void {
		this.worker.removeEventListener('message', this.onMessage as EventListener);
		this.worker.removeEventListener('error', this.onError as EventListener);
		this.worker.removeEventListener('messageerror', this.onMessageError as EventListener);
	}

	private failWorker(error: Error): void {
		if (this.state === 'disposed') return;
		const ownsCleanup = this.state === 'active';
		if (ownsCleanup) this.state = 'disposed';
		this.rejectAllPending(error);
		this.removeWorkerListeners();
		this.worker.terminate();
		this.workerLabel = null;
		if (ownsCleanup) {
			this.disposePromise = Promise.resolve().then(() => this.fallbackClient.dispose());
			void this.disposePromise.catch(() => undefined);
		}
	}

	private postRequest(
		request: WorkerRequest,
		transfer: Transferable[] = [],
		options: PostRequestOptions = {}
	): Promise<WorkerResponse> {
		if (this.state === 'disposed' || (this.state === 'disposing' && request.type !== 'dispose')) {
			return Promise.reject(new ClientDisposedError('The worker client is no longer accepting requests.'));
		}
		if (options.signal?.aborted) return Promise.reject(abortError(options.signal));

		return new Promise((resolve, reject) => {
			const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
			validateTimeout(timeoutMs, 'Worker request timeout');
			const pending: PendingRequest = {
				resolve,
				reject,
				requestType: request.type,
				expectedResults: options.expectedResults,
				onProgress: options.onProgress,
				timer: setTimeout(() => {
					const current = this.pendingRequests.get(request.requestId);
					if (!current) return;
					this.clearPending(request.requestId, current);
					reject(new Error(`Worker request "${request.type}" timed out after ${timeoutMs} ms.`));
				}, timeoutMs)
			};
			if (options.signal) {
				const signal = options.signal;
				const onAbort = (): void => {
					const current = this.pendingRequests.get(request.requestId);
					if (!current) return;
					this.clearPending(request.requestId, current);
					reject(abortError(signal));
				};
				signal.addEventListener('abort', onAbort, { once: true });
				pending.removeAbortListener = () => signal.removeEventListener('abort', onAbort);
			}
			this.pendingRequests.set(request.requestId, pending);
			try {
				this.worker.postMessage(request, transfer);
			} catch (error) {
				this.clearPending(request.requestId, pending);
				reject(error instanceof Error ? error : new Error('Failed to send worker request.'));
			}
		});
	}

	async load(options?: LoadOptions): Promise<void> {
		this.assertActive();
		await this.initializationPromise;
		const response = await this.postRequest(
			{ requestId: this.nextRequestId(), type: 'load' },
			[],
			{ onProgress: options?.onProgress }
		);
		this.workerLabel = response.label ?? null;
	}

	async remove(input: RemoveBackgroundInput, options?: RemoveOptions): Promise<RemoveResult> {
		this.assertActive();
		if (!isWorkerSafeInput(input)) {
			return await this.fallbackClient.remove(input, options);
		}
		await this.initializationPromise;
		const transfer = typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap ? [input] : [];
		const response = await this.postRequest(
			{
				requestId: this.nextRequestId(),
				type: 'remove',
				input,
				options: withoutSignal(options)
			},
			transfer,
			{ signal: options?.signal }
		);
		if (!response.result) throw new Error('Worker remove response missing result payload.');
		const { bitmap, width, height } = response.result;
		return {
			canvas: toHtmlCanvas(bitmap, width, height, this.maxOutputPixels),
			width,
			height
		};
	}

	async removeMany(
		inputs: RemoveBackgroundInput[],
		options?: RemoveOptions,
		batchOptions?: BatchProcessOptions
	): Promise<RemoveResult[]> {
		this.assertActive();
		const workerSafeInputs = inputs.filter(isWorkerSafeInput);
		if (workerSafeInputs.length !== inputs.length) {
			return await this.fallbackClient.removeMany(inputs, options, batchOptions);
		}
		await this.initializationPromise;
		const transfer = workerSafeInputs.filter(
			(value): value is ImageBitmap => typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap
		);
		const response = await this.postRequest(
			{
				requestId: this.nextRequestId(),
				type: 'removeMany',
				inputs: workerSafeInputs,
				options: withoutSignal(options),
				batchOptions
			},
			transfer,
			{ expectedResults: workerSafeInputs.length, signal: options?.signal }
		);
		if (!response.results) throw new Error('Worker removeMany response missing result payloads.');
		try {
			return response.results.map(({ bitmap, width, height }) => ({
				canvas: toHtmlCanvas(bitmap, width, height, this.maxOutputPixels),
				width,
				height
			}));
		} catch (error) {
			for (const result of response.results) closeBitmap(result.bitmap);
			throw error;
		}
	}

	getLoadedModelLabel(): string | null {
		return this.workerLabel ?? this.fallbackClient.getLoadedModelLabel();
	}

	dispose(): Promise<void> {
		if (this.disposePromise) return this.disposePromise;
		if (this.state === 'disposed') return Promise.resolve();
		this.state = 'disposing';

		this.disposePromise = (async () => {
			try {
				let initializationTimer: ReturnType<typeof setTimeout> | undefined;
				const initialized = await Promise.race([
					this.initializationPromise.then(
						() => true,
						() => false
					),
					new Promise<false>((resolve) => {
						initializationTimer = setTimeout(
							() => resolve(false),
							Math.min(this.requestTimeoutMs, DEFAULT_WORKER_DISPOSE_TIMEOUT_MS)
						);
					})
				]);
				if (initializationTimer) clearTimeout(initializationTimer);
				if (initialized) {
					await this.postRequest(
						{ requestId: this.nextRequestId(), type: 'dispose' },
						[],
						{ timeoutMs: Math.min(this.requestTimeoutMs, DEFAULT_WORKER_DISPOSE_TIMEOUT_MS) }
					);
				}
			} finally {
				this.rejectAllPending(new ClientDisposedError('The worker client has been disposed.'));
				this.removeWorkerListeners();
				this.worker.terminate();
				this.workerLabel = null;
				try {
					await this.fallbackClient.dispose();
				} finally {
					this.state = 'disposed';
				}
			}
		})();
		return this.disposePromise;
	}
}

export function createWorkerClient(options?: WorkerClientOptions): RemoveBackgroundClient {
	if (options !== undefined && !isRecord(options)) {
		throw new TypeError('Worker client options must be an object.');
	}
	const workerOptions = options as WorkerClientOptions | undefined;
	if (workerOptions?.requestTimeoutMs !== undefined) {
		validateTimeout(workerOptions.requestTimeoutMs, 'requestTimeoutMs');
	}
	const mode = workerOptions?.mode ?? 'auto';
	if (!['auto', 'worker', 'main-thread'].includes(mode)) {
		throw new TypeError('mode must be "auto", "worker", or "main-thread".');
	}
	if (workerOptions?.workerFactory !== undefined && typeof workerOptions.workerFactory !== 'function') {
		throw new TypeError('workerFactory must be a function.');
	}
	const supported = supportsWorkerMode();
	if (mode === 'main-thread') {
		return createClient(workerOptions?.config);
	}
	if (!supported || !workerOptions?.workerFactory) {
		if (mode === 'worker') {
			throw new Error('Worker mode requires Worker, OffscreenCanvas, and a workerFactory.');
		}
		return createClient(workerOptions?.config);
	}
	resolveClientConfig(workerOptions.config);

	let worker: Worker | undefined;
	try {
		worker = workerOptions.workerFactory();
		return new WorkerBackedClient(worker, workerOptions.config, workerOptions.requestTimeoutMs);
	} catch (error) {
		if (worker && typeof worker.terminate === 'function') worker.terminate();
		if (mode === 'auto') return createClient(workerOptions.config);
		throw error;
	}
}
