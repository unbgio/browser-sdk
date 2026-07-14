import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createFallbackClient() {
	return {
		load: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn(),
		removeMany: vi.fn(),
		getLoadedModelLabel: vi.fn(() => null),
		dispose: vi.fn().mockResolvedValue(undefined)
	};
}

const createClientMock = vi.fn(createFallbackClient);

vi.mock('../../src/client', () => ({
	createClient: createClientMock
}));

class FakeWorker {
	public readonly posted: Array<{ message: any; transfer: Transferable[] }> = [];
	public terminated = false;
	public onPost: ((message: any) => void) | null = null;
	private readonly listeners = new Map<string, Set<EventListener>>();

	addEventListener(name: string, listener: EventListener): void {
		const listeners = this.listeners.get(name) ?? new Set<EventListener>();
		listeners.add(listener);
		this.listeners.set(name, listeners);
	}

	removeEventListener(name: string, listener: EventListener): void {
		this.listeners.get(name)?.delete(listener);
	}

	postMessage(message: any, transfer: Transferable[] = []): void {
		this.posted.push({ message, transfer });
		this.onPost?.(message);
	}

	emit(name: string, event: unknown): void {
		for (const listener of this.listeners.get(name) ?? []) listener(event as Event);
	}

	respond(data: any): void {
		this.emit('message', { data } as MessageEvent);
	}

	terminate(): void {
		this.terminated = true;
	}
}

const originalWorker = (globalThis as { Worker?: unknown }).Worker;
const originalOffscreen = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;

function enableWorkerApis(): void {
	(globalThis as { Worker?: unknown }).Worker = FakeWorker as unknown;
	(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {};
}

function respondToLifecycle(worker: FakeWorker): void {
	worker.onPost = (message) => {
		if (message.type === 'initialize') {
			queueMicrotask(() => worker.respond({ type: 'response', requestId: message.requestId, ok: true }));
		}
		if (message.type === 'dispose') {
			queueMicrotask(() => worker.respond({ type: 'response', requestId: message.requestId, ok: true }));
		}
	};
}

describe('createWorkerClient', () => {
	beforeEach(() => {
		createClientMock.mockReset();
		createClientMock.mockImplementation(createFallbackClient);
		enableWorkerApis();
	});

	afterEach(() => {
		(globalThis as { Worker?: unknown }).Worker = originalWorker;
		(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = originalOffscreen;
		vi.restoreAllMocks();
	});

	it('initializes worker config, relays progress, caches its label, and closes output bitmaps', async () => {
		const worker = new FakeWorker();
		const bitmap = { close: vi.fn() };
		const batchBitmaps = [{ close: vi.fn() }, { close: vi.fn() }];
		worker.onPost = (message) => {
			if (message.type === 'initialize') {
				queueMicrotask(() => worker.respond({ type: 'response', requestId: message.requestId, ok: true }));
			}
			if (message.type === 'load') {
				queueMicrotask(() => {
					worker.respond({
						type: 'progress',
						requestId: message.requestId,
						progress: { status: 'progress', progress: 42 }
					});
					worker.respond({
						type: 'response',
						requestId: message.requestId,
						ok: true,
						label: 'Worker WASM q8'
					});
				});
			}
			if (message.type === 'remove') {
				queueMicrotask(() =>
					worker.respond({
						type: 'response',
						requestId: message.requestId,
						ok: true,
						result: { bitmap, width: 4, height: 3 }
					})
				);
			}
			if (message.type === 'removeMany') {
				queueMicrotask(() =>
					worker.respond({
						type: 'response',
						requestId: message.requestId,
						ok: true,
						results: [
							{ bitmap: batchBitmaps[0], width: 2, height: 3 },
							{ bitmap: batchBitmaps[1], width: 4, height: 5 }
						]
					})
				);
			}
			if (message.type === 'dispose') {
				queueMicrotask(() => worker.respond({ type: 'response', requestId: message.requestId, ok: true }));
			}
		};
		const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
			drawImage: vi.fn()
		} as unknown as CanvasRenderingContext2D);
		const progress = vi.fn();
		const { createWorkerClient } = await import('../../src/worker-client');
		const client = createWorkerClient({
			config: { model: { revision: 'worker-revision' } },
			workerFactory: () => worker as unknown as Worker
		});

		await client.load({ onProgress: progress });
		const result = await client.remove(new Blob(['x']));
		const batch = await client.removeMany([new Blob(['a']), new Blob(['b'])]);

		expect(result).toMatchObject({ width: 4, height: 3 });
		expect(batch.map(({ width, height }) => [width, height])).toEqual([
			[2, 3],
			[4, 5]
		]);
		expect(progress).toHaveBeenCalledWith({ status: 'progress', progress: 42 });
		expect(client.getLoadedModelLabel()).toBe('Worker WASM q8');
		expect(bitmap.close).toHaveBeenCalledTimes(1);
		expect(batchBitmaps.every(({ close }) => close.mock.calls.length === 1)).toBe(true);
		const initialize = worker.posted.find(({ message }) => message.type === 'initialize')?.message;
		expect(initialize.config).toEqual({ model: { revision: 'worker-revision' } });
		expect(worker.posted.find(({ message }) => message.type === 'load')?.message).not.toHaveProperty('options');

		await client.dispose();
		expect(worker.terminated).toBe(true);
		getContextSpy.mockRestore();
	});

	it('waits for an acknowledged worker shutdown before terminating', async () => {
		const worker = new FakeWorker();
		respondToLifecycle(worker);
		let disposeRequest: any;
		worker.onPost = (message) => {
			if (message.type === 'initialize') {
				queueMicrotask(() => worker.respond({ type: 'response', requestId: message.requestId, ok: true }));
			}
			if (message.type === 'dispose') disposeRequest = message;
		};
		const { createWorkerClient } = await import('../../src/worker-client');
		const client = createWorkerClient({ workerFactory: () => worker as unknown as Worker });
		await vi.waitFor(() => expect(worker.posted.some(({ message }) => message.type === 'initialize')).toBe(true));

		const disposing = client.dispose();
		await vi.waitFor(() => expect(disposeRequest).toBeTruthy());
		expect(worker.terminated).toBe(false);
		worker.respond({ type: 'response', requestId: disposeRequest.requestId, ok: true });
		await disposing;
		expect(worker.terminated).toBe(true);
	});

	it('times out hung requests and rejects pending requests on worker errors', async () => {
		const worker = new FakeWorker();
		respondToLifecycle(worker);
		const { createWorkerClient } = await import('../../src/worker-client');
		const client = createWorkerClient({
			workerFactory: () => worker as unknown as Worker,
			requestTimeoutMs: 20
		});

		await expect(client.remove(new Blob(['timeout']))).rejects.toThrow('timed out');
		await client.dispose();

		const failedWorker = new FakeWorker();
		respondToLifecycle(failedWorker);
		const failedClient = createWorkerClient({ workerFactory: () => failedWorker as unknown as Worker });
		const pending = failedClient.remove(new Blob(['pending']));
		await vi.waitFor(() =>
			expect(failedWorker.posted.some(({ message }) => message.type === 'remove')).toBe(true)
		);
		failedWorker.emit('error', { message: 'worker crashed' });
		await expect(pending).rejects.toThrow('worker crashed');
		expect(failedWorker.terminated).toBe(true);
	});

	it('supports caller cancellation and closes orphaned late response bitmaps', async () => {
		const worker = new FakeWorker();
		respondToLifecycle(worker);
		const controller = new AbortController();
		const { createWorkerClient } = await import('../../src/worker-client');
		const client = createWorkerClient({ workerFactory: () => worker as unknown as Worker });
		const pending = client.remove(new Blob(['pending']), { signal: controller.signal });
		await vi.waitFor(() =>
			expect(worker.posted.some(({ message }) => message.type === 'remove')).toBe(true)
		);
		const request = worker.posted.find(({ message }) => message.type === 'remove')!.message;
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

		const bitmap = { close: vi.fn() };
		worker.respond({
			type: 'response',
			requestId: request.requestId,
			ok: true,
			result: { bitmap, width: 1, height: 1 }
		});
		expect(bitmap.close).toHaveBeenCalledTimes(1);
		await client.dispose();
	});

	it('falls back to the main thread for unsafe inputs or unavailable worker APIs', async () => {
		const fallback = createFallbackClient();
		fallback.removeMany.mockResolvedValue([
			{ canvas: document.createElement('canvas'), width: 1, height: 1 }
		]);
		createClientMock.mockReturnValueOnce(fallback);
		const worker = new FakeWorker();
		respondToLifecycle(worker);
		const { createWorkerClient } = await import('../../src/worker-client');
		const client = createWorkerClient({ workerFactory: () => worker as unknown as Worker });

		await client.removeMany([document.createElement('canvas')]);
		expect(fallback.removeMany).toHaveBeenCalledTimes(1);
		await client.dispose();

		(globalThis as { Worker?: unknown }).Worker = undefined;
		(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = undefined;
		createWorkerClient({ mode: 'auto' });
		expect(createClientMock).toHaveBeenCalledTimes(2);
	});

	it('falls back in auto mode when the worker factory throws', async () => {
		const fallback = createFallbackClient();
		createClientMock.mockReturnValueOnce(fallback);
		const { createWorkerClient } = await import('../../src/worker-client');
		const client = createWorkerClient({
			mode: 'auto',
			workerFactory: () => {
				throw new Error('worker construction failed');
			}
		});

		expect(createClientMock).toHaveBeenCalledTimes(1);
		await client.dispose();
		expect(fallback.dispose).toHaveBeenCalledTimes(1);
		expect(() =>
			createWorkerClient({
				mode: 'worker',
				workerFactory: () => {
					throw new Error('worker construction failed');
				}
			})
		).toThrow('worker construction failed');
	});

	it('bounds initialization shutdown and awaits fallback cleanup after worker failure', async () => {
		let finishFallbackDispose!: () => void;
		const fallback = createFallbackClient();
		fallback.dispose.mockReturnValue(
			new Promise<void>((resolve) => {
				finishFallbackDispose = resolve;
			})
		);
		createClientMock.mockReturnValueOnce(fallback);
		const failedWorker = new FakeWorker();
		respondToLifecycle(failedWorker);
		const { createWorkerClient } = await import('../../src/worker-client');
		const failedClient = createWorkerClient({ workerFactory: () => failedWorker as unknown as Worker });
		await vi.waitFor(() =>
			expect(failedWorker.posted.some(({ message }) => message.type === 'initialize')).toBe(true)
		);
		failedWorker.emit('error', { message: 'worker crashed' });
		const cleanup = failedClient.dispose();
		let cleaned = false;
		void cleanup.then(() => (cleaned = true));
		await Promise.resolve();
		expect(cleaned).toBe(false);
		finishFallbackDispose();
		await cleanup;
		expect(fallback.dispose).toHaveBeenCalledTimes(1);

		const hungWorker = new FakeWorker();
		const hungClient = createWorkerClient({
			workerFactory: () => hungWorker as unknown as Worker,
			requestTimeoutMs: 20
		});
		await hungClient.dispose();
		expect(hungWorker.terminated).toBe(true);
	});

	it('rejects oversized worker result payloads and closes their bitmaps', async () => {
		const worker = new FakeWorker();
		const bitmap = { close: vi.fn() };
		worker.onPost = (message) => {
			if (message.type === 'initialize' || message.type === 'dispose') {
				queueMicrotask(() => worker.respond({ type: 'response', requestId: message.requestId, ok: true }));
			}
			if (message.type === 'remove') {
				queueMicrotask(() =>
					worker.respond({
						type: 'response',
						requestId: message.requestId,
						ok: true,
						result: { bitmap, width: 3, height: 2 }
					})
				);
			}
		};
		const { createWorkerClient } = await import('../../src/worker-client');
		const client = createWorkerClient({
			config: { performance: { maxInputPixels: 4 } },
			workerFactory: () => worker as unknown as Worker
		});

		await expect(client.remove(new Blob(['x']))).rejects.toThrow('oversized');
		expect(bitmap.close).toHaveBeenCalledTimes(1);
		await client.dispose();
	});

	it('rejects invalid runtime worker options', async () => {
		const { createWorkerClient } = await import('../../src/worker-client');
		expect(() => createWorkerClient({ mode: 'invalid' as never })).toThrow(TypeError);
		expect(() => createWorkerClient({ requestTimeoutMs: 2_147_483_648 })).toThrow(TypeError);
		expect(() => createWorkerClient(null as never)).toThrow(TypeError);
		expect(() => createWorkerClient({ mode: 'worker' })).toThrow('requires');
	});
});
