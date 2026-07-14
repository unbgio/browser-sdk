import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = {
	load: vi.fn(),
	remove: vi.fn(),
	removeMany: vi.fn(),
	getLoadedModelLabel: vi.fn(() => 'Runtime WASM q8'),
	dispose: vi.fn().mockResolvedValue(undefined)
};
const createClientMock = vi.fn(() => client);

vi.mock('../../src/client', () => ({
	createClient: createClientMock
}));

class FakeScope {
	public onmessage: ((event: MessageEvent<any>) => void) | null = null;
	public readonly posted: Array<{ message: any; transfer: Transferable[] }> = [];

	postMessage(message: any, transfer: Transferable[] = []): void {
		this.posted.push({ message, transfer });
	}

	send(data: any): void {
		this.onmessage?.({ data } as MessageEvent);
	}
}

describe('attachWorkerRuntime', () => {
	beforeEach(() => {
		createClientMock.mockClear();
		client.load.mockReset().mockResolvedValue(undefined);
		client.remove.mockReset();
		client.removeMany.mockReset();
		client.getLoadedModelLabel.mockReset().mockReturnValue('Runtime WASM q8');
		client.dispose.mockReset().mockResolvedValue(undefined);
	});

	it('initializes with posted config, emits progress, and transfers remove results', async () => {
		client.load.mockImplementation(async (options?: { onProgress?: (value: unknown) => void }) => {
			options?.onProgress?.({ status: 'progress', progress: 55 });
		});
		const bitmap = { close: vi.fn() };
		const batchBitmaps = [{ close: vi.fn() }, { close: vi.fn() }];
		client.remove.mockResolvedValue({
			canvas: { transferToImageBitmap: () => bitmap },
			width: 5,
			height: 6
		});
		client.removeMany.mockResolvedValue([
			{ canvas: { transferToImageBitmap: () => batchBitmaps[0] }, width: 2, height: 3 },
			{ canvas: { transferToImageBitmap: () => batchBitmaps[1] }, width: 4, height: 5 }
		]);
		const scope = new FakeScope();
		const { attachWorkerRuntime } = await import('../../src/worker-runtime');
		attachWorkerRuntime(scope as never);

		scope.send({
			type: 'initialize',
			requestId: 'init',
			config: { model: { revision: 'abc123' } }
		});
		await vi.waitFor(() => expect(scope.posted).toHaveLength(1));
		expect(createClientMock).toHaveBeenCalledWith({ model: { revision: 'abc123' } });

		scope.send({ type: 'load', requestId: 'load' });
		await vi.waitFor(() => expect(scope.posted).toHaveLength(3));
		expect(scope.posted[1].message).toEqual({
			type: 'progress',
			requestId: 'load',
			progress: { status: 'progress', progress: 55 }
		});
		expect(scope.posted[2].message).toMatchObject({
			type: 'response',
			requestId: 'load',
			ok: true,
			label: 'Runtime WASM q8'
		});

		scope.send({ type: 'remove', requestId: 'remove', input: new Blob(['x']) });
		await vi.waitFor(() => expect(scope.posted).toHaveLength(4));
		expect(scope.posted[3].message.result).toMatchObject({ width: 5, height: 6 });
		expect(scope.posted[3].transfer).toEqual([bitmap]);

		scope.send({
			type: 'removeMany',
			requestId: 'batch',
			inputs: [new Blob(['a']), new Blob(['b'])]
		});
		await vi.waitFor(() => expect(scope.posted).toHaveLength(5));
		expect(scope.posted[4].message.results).toHaveLength(2);
		expect(scope.posted[4].transfer).toEqual(batchBitmaps);
	});

	it('serializes disposal behind active work and acknowledges it after async cleanup', async () => {
		let finishLoad!: () => void;
		client.load.mockReturnValue(new Promise<void>((resolve) => (finishLoad = resolve)));
		const scope = new FakeScope();
		const { attachWorkerRuntime } = await import('../../src/worker-runtime');
		attachWorkerRuntime(scope as never);
		scope.send({ type: 'initialize', requestId: 'init' });
		await vi.waitFor(() => expect(scope.posted).toHaveLength(1));

		scope.send({ type: 'load', requestId: 'load' });
		scope.send({ type: 'dispose', requestId: 'dispose' });
		await Promise.resolve();
		expect(client.dispose).not.toHaveBeenCalled();

		finishLoad();
		await vi.waitFor(() =>
			expect(scope.posted.some(({ message }) => message.requestId === 'dispose')).toBe(true)
		);
		expect(client.dispose).toHaveBeenCalledTimes(1);
		expect(scope.posted.at(-1)?.message).toMatchObject({
			type: 'response',
			requestId: 'dispose',
			ok: true
		});
	});

	it('returns structured errors for requests before initialization', async () => {
		const scope = new FakeScope();
		const { attachWorkerRuntime } = await import('../../src/worker-runtime');
		attachWorkerRuntime(scope as never);
		scope.send({ type: 'load', requestId: 'early' });
		await vi.waitFor(() => expect(scope.posted).toHaveLength(1));
		expect(scope.posted[0].message).toMatchObject({
			type: 'response',
			requestId: 'early',
			ok: false,
			error: expect.stringContaining('initialized')
		});
	});

	it('rejects malformed protocol messages without replacing a healthy client', async () => {
		const scope = new FakeScope();
		const { attachWorkerRuntime } = await import('../../src/worker-runtime');
		attachWorkerRuntime(scope as never);
		scope.send({ type: 'initialize', requestId: 'init' });
		await vi.waitFor(() => expect(scope.posted).toHaveLength(1));

		scope.send({
			type: 'initialize',
			requestId: 'invalid-config',
			config: { performance: { maxBatchSize: 0 } }
		});
		await vi.waitFor(() => expect(scope.posted).toHaveLength(2));
		expect(scope.posted[1].message).toMatchObject({
			requestId: 'invalid-config',
			ok: false,
			error: expect.stringContaining('positive')
		});
		expect(client.dispose).not.toHaveBeenCalled();

		scope.send({ type: 'not-real', requestId: 'unknown' });
		await vi.waitFor(() => expect(scope.posted).toHaveLength(3));
		expect(scope.posted[2].message).toMatchObject({
			requestId: 'unknown',
			ok: false,
			error: expect.stringContaining('Unknown')
		});
	});
});
