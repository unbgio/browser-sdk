import { createClient, type RemoveBackgroundClient } from './client';
import { resolveClientConfig } from './config';
import type {
	ClientConfig,
	WorkerRemovePayload,
	WorkerRequest,
	WorkerRuntimeScope,
	WorkerResponse
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isWorkerInput(value: unknown): boolean {
	if (typeof value === 'string') return value.length > 0;
	if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
	return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;
}

function validateRequest(value: unknown): WorkerRequest {
	if (!isRecord(value)) throw new TypeError('Worker request must be an object.');
	if (
		typeof value.requestId !== 'string' ||
		value.requestId.length === 0 ||
		value.requestId.length > 200
	) {
		throw new TypeError('Worker requestId must be a string between 1 and 200 characters.');
	}

	switch (value.type) {
		case 'initialize':
			if (value.config !== undefined && !isRecord(value.config)) {
				throw new TypeError('Worker initialize config must be an object.');
			}
			return value as unknown as WorkerRequest;
		case 'load':
		case 'dispose':
			return value as unknown as WorkerRequest;
		case 'remove':
			if (!isWorkerInput(value.input)) throw new TypeError('Worker remove input is invalid.');
			if (value.options !== undefined && !isRecord(value.options)) {
				throw new TypeError('Worker remove options must be an object.');
			}
			return value as unknown as WorkerRequest;
		case 'removeMany':
			if (!Array.isArray(value.inputs) || !value.inputs.every(isWorkerInput)) {
				throw new TypeError('Worker removeMany inputs must be an array of supported inputs.');
			}
			if (value.options !== undefined && !isRecord(value.options)) {
				throw new TypeError('Worker removeMany options must be an object.');
			}
			if (value.batchOptions !== undefined && !isRecord(value.batchOptions)) {
				throw new TypeError('Worker batch options must be an object.');
			}
			return value as unknown as WorkerRequest;
		default:
			throw new TypeError('Unknown worker request type.');
	}
}

function closePayloads(payloads: WorkerRemovePayload[]): void {
	for (const payload of payloads) {
		try {
			payload.bitmap.close();
		} catch {
			// Continue closing the remaining transferred resources.
		}
	}
}

function toBitmapPayload(result: {
	canvas: HTMLCanvasElement;
	width: number;
	height: number;
}): Promise<WorkerRemovePayload> {
	const runtimeCanvas = result.canvas as unknown as {
		transferToImageBitmap?: () => ImageBitmap;
		convertToBlob?: (options?: { type?: string; quality?: number }) => Promise<Blob>;
	};

	if (runtimeCanvas.transferToImageBitmap) {
		return Promise.resolve({
			bitmap: runtimeCanvas.transferToImageBitmap(),
			width: result.width,
			height: result.height
		});
	}

	if (runtimeCanvas.convertToBlob && typeof createImageBitmap !== 'undefined') {
		return runtimeCanvas.convertToBlob({ type: 'image/png' }).then(async (blob) => ({
			bitmap: await createImageBitmap(blob),
			width: result.width,
			height: result.height
		}));
	}

	return Promise.reject(new Error('Unable to convert worker result into ImageBitmap.'));
}

async function toBitmapPayloads(
	results: Array<{ canvas: HTMLCanvasElement; width: number; height: number }>
): Promise<WorkerRemovePayload[]> {
	const payloads: WorkerRemovePayload[] = [];
	try {
		for (const result of results) payloads.push(await toBitmapPayload(result));
		return payloads;
	} catch (error) {
		closePayloads(payloads);
		throw error;
	}
}

function postResponse(scope: WorkerRuntimeScope, response: WorkerResponse): void {
	const payloads = [response.result, ...(response.results ?? [])].filter(
		(payload): payload is WorkerRemovePayload => Boolean(payload)
	);
	try {
		scope.postMessage(response, payloads.map((payload) => payload.bitmap));
	} catch (error) {
		closePayloads(payloads);
		throw error;
	}
}

export function attachWorkerRuntime(scope: WorkerRuntimeScope, initialConfig?: ClientConfig): void {
	let client: RemoveBackgroundClient | null = initialConfig ? createClient(initialConfig) : null;
	let disposed = false;
	let queue = Promise.resolve();

	const respond = (response: Omit<WorkerResponse, 'type'>): void => {
		postResponse(scope, { type: 'response', ...response });
	};

	const handleRequest = async (value: unknown): Promise<void> => {
		const requestId = isRecord(value) && typeof value.requestId === 'string' ? value.requestId : '';
		try {
			const request = validateRequest(value);
			if (request.type === 'initialize') {
				if (disposed) throw new Error('Worker runtime has already been disposed.');
				const config = request.config ?? initialConfig;
				resolveClientConfig(config);
				const replacement = createClient(config);
				const previous = client;
				client = replacement;
				if (previous) await previous.dispose();
				respond({ requestId: request.requestId, ok: true });
				return;
			}

			if (!client) throw new Error('Worker runtime must be initialized before use.');

			if (request.type === 'load') {
				await client.load({
					onProgress: (progress) => {
						scope.postMessage({
							type: 'progress',
							requestId: request.requestId,
							progress
						});
					}
				});
				respond({
					requestId: request.requestId,
					ok: true,
					label: client.getLoadedModelLabel()
				});
				return;
			}

			if (request.type === 'remove') {
				const result = await client.remove(request.input, request.options);
				const payload = await toBitmapPayload(result);
				respond({ requestId: request.requestId, ok: true, result: payload });
				return;
			}

			if (request.type === 'removeMany') {
				const results = await client.removeMany(request.inputs, request.options, request.batchOptions);
				const payloads = await toBitmapPayloads(results);
				respond({ requestId: request.requestId, ok: true, results: payloads });
				return;
			}

			if (request.type === 'dispose') {
				await client.dispose();
				client = null;
				disposed = true;
				respond({ requestId: request.requestId, ok: true });
				return;
			}

		} catch (error) {
			if (!requestId) return;
			respond({
				requestId,
				ok: false,
				error: error instanceof Error ? error.message : 'Unknown worker runtime error'
			});
		}
	};

	scope.onmessage = (event) => {
		queue = queue.then(() => handleRequest(event.data), () => handleRequest(event.data));
	};
}
