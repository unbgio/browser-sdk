import { beforeEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.fn(() => ({
	load: vi.fn(),
	remove: vi.fn(),
	removeMany: vi.fn(),
	getLoadedModelLabel: vi.fn(() => null),
	dispose: vi.fn()
}));

vi.mock('../../src/client', () => ({
	createClient: createClientMock
}));

describe('createWorkerClient', () => {
	beforeEach(() => {
		createClientMock.mockClear();
	});

	it('uses worker path for safe remove and dispose', async () => {
		class FakeWorker {
			private listeners = new Set<(event: MessageEvent<any>) => void>();
			public terminated = false;

			addEventListener(_name: string, listener: EventListener): void {
				this.listeners.add(listener as (event: MessageEvent<any>) => void);
			}

			removeEventListener(_name: string, listener: EventListener): void {
				this.listeners.delete(listener as (event: MessageEvent<any>) => void);
			}

			postMessage(message: any): void {
				let response: any = { requestId: message.requestId, ok: true };
				if (message.type === 'remove') {
					response = {
						requestId: message.requestId,
						ok: true,
						result: { bitmap: { id: 'bitmap' }, width: 4, height: 3 }
					};
				}
				queueMicrotask(() => {
					for (const listener of this.listeners) {
						listener({ data: response } as MessageEvent<any>);
					}
				});
			}

			terminate(): void {
				this.terminated = true;
			}
		}

		const originalWorker = (globalThis as { Worker?: unknown }).Worker;
		const originalOffscreen = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
		(globalThis as { Worker?: unknown }).Worker = FakeWorker as unknown;
		(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {};

		const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
			() =>
				({
					drawImage: () => undefined
				}) as unknown as CanvasRenderingContext2D
		);

		const { createWorkerClient } = await import('../../src/worker-client');
		const worker = new FakeWorker();
		const client = createWorkerClient({
			workerFactory: () => worker as unknown as Worker
		});
		const result = await client.remove(new Blob(['x']));
		expect(result.width).toBe(4);
		client.dispose();
		expect(worker.terminated).toBe(true);

		getContextSpy.mockRestore();
		(globalThis as { Worker?: unknown }).Worker = originalWorker;
		(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = originalOffscreen;
	});

	it('falls back to main-thread removeMany for unsafe inputs', async () => {
		const fallbackRemoveMany = vi.fn().mockResolvedValue([
			{ canvas: document.createElement('canvas'), width: 1, height: 1 }
		]);
		createClientMock.mockReturnValueOnce({
			load: vi.fn(),
			remove: vi.fn(),
			removeMany: fallbackRemoveMany,
			getLoadedModelLabel: vi.fn(() => null),
			dispose: vi.fn()
		});

		const originalWorker = (globalThis as { Worker?: unknown }).Worker;
		const originalOffscreen = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
		(globalThis as { Worker?: unknown }).Worker = class {} as unknown;
		(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {};

		const { createWorkerClient } = await import('../../src/worker-client');
		const client = createWorkerClient({
			workerFactory: () =>
				({
					addEventListener: () => undefined,
					removeEventListener: () => undefined,
					postMessage: () => undefined,
					terminate: () => undefined
				}) as unknown as Worker
		});
		await client.removeMany([document.createElement('canvas')]);
		expect(fallbackRemoveMany).toHaveBeenCalledTimes(1);

		(globalThis as { Worker?: unknown }).Worker = originalWorker;
		(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = originalOffscreen;
	});

	it('falls back to main-thread client when worker APIs are unavailable', async () => {
		const originalWorker = (globalThis as { Worker?: unknown }).Worker;
		const originalOffscreen = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
		(globalThis as { Worker?: unknown }).Worker = undefined;
		(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = undefined;

		const { createWorkerClient } = await import('../../src/worker-client');
		createWorkerClient({ mode: 'auto' });

		expect(createClientMock).toHaveBeenCalledTimes(1);

		(globalThis as { Worker?: unknown }).Worker = originalWorker;
		(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = originalOffscreen;
	});
});
