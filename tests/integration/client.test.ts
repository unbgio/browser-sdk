import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadModelBundleMock = vi.fn();
const configureTransformerRuntimeMock = vi.fn();
const disposeModelBundleMock = vi.fn();
const removeBackgroundWithModelMock = vi.fn();

vi.mock('../../src/model', () => ({
	loadModelBundle: loadModelBundleMock,
	configureTransformerRuntime: configureTransformerRuntimeMock,
	disposeModelBundle: disposeModelBundleMock
}));

vi.mock('../../src/pipeline', () => ({
	removeBackgroundWithModel: removeBackgroundWithModelMock
}));

describe('client API', () => {
	beforeEach(() => {
		loadModelBundleMock.mockReset();
		configureTransformerRuntimeMock.mockReset();
		disposeModelBundleMock.mockReset().mockResolvedValue(undefined);
		removeBackgroundWithModelMock.mockReset();
	});

	it('loads model only once and exposes loaded label', async () => {
		loadModelBundleMock.mockResolvedValue({
			model: { id: 'mock-model' },
			processor: { id: 'mock-processor' },
			label: 'Mock Candidate'
		});

		const { createClient } = await import('../../src/client');
		const client = createClient();
		await client.load();
		await client.load();

		expect(loadModelBundleMock).toHaveBeenCalledTimes(1);
		expect(client.getLoadedModelLabel()).toBe('Mock Candidate');
	});

	it('remove() delegates to pipeline and auto-loads first', async () => {
		loadModelBundleMock.mockResolvedValue({
			model: { id: 'mock-model' },
			processor: { id: 'mock-processor' },
			label: 'Mock Candidate'
		});
		removeBackgroundWithModelMock.mockResolvedValue({
			canvas: document.createElement('canvas'),
			width: 1,
			height: 1
		});

		const { createClient } = await import('../../src/client');
		const client = createClient();
		await client.remove('https://example.com/photo.png');

		expect(loadModelBundleMock).toHaveBeenCalledTimes(1);
		expect(removeBackgroundWithModelMock).toHaveBeenCalledTimes(1);
	});

	it('removeMany() preserves order and emits telemetry hooks', async () => {
		loadModelBundleMock.mockResolvedValue({
			model: { id: 'mock-model' },
			processor: { id: 'mock-processor' },
			label: 'Mock Candidate'
		});
		const canvases = [document.createElement('canvas'), document.createElement('canvas')];
		removeBackgroundWithModelMock
			.mockResolvedValueOnce({ canvas: canvases[0], width: 1, height: 1 })
			.mockResolvedValueOnce({ canvas: canvases[1], width: 2, height: 2 });
		const telemetry = vi.fn();

		const { createClient } = await import('../../src/client');
		const client = createClient({
			hooks: { telemetry }
		});
		const results = await client.removeMany(
			['https://example.com/a.png', 'https://example.com/b.png'],
			undefined,
			{ concurrency: 2 }
		);

		expect(results[0].width).toBe(1);
		expect(results[1].width).toBe(2);
		expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({ type: 'removeMany:start' }));
		expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({ type: 'removeMany:success' }));
	});

	it('disposes loaded resources asynchronously and only once', async () => {
		const bundle = {
			model: { id: 'mock-model' },
			processor: { id: 'mock-processor' },
			label: 'Mock Candidate'
		};
		loadModelBundleMock.mockResolvedValue(bundle);
		const { createClient } = await import('../../src/client');
		const client = createClient();
		await client.load();

		const first = client.dispose();
		const second = client.dispose();
		await Promise.all([first, second]);

		expect(disposeModelBundleMock).toHaveBeenCalledTimes(1);
		expect(disposeModelBundleMock).toHaveBeenCalledWith(bundle);
		await expect(client.load()).rejects.toMatchObject({ name: 'ClientDisposedError' });
	});

	it('disposes a model that finishes loading after disposal starts', async () => {
		let finishLoad!: (bundle: unknown) => void;
		loadModelBundleMock.mockReturnValue(new Promise((resolve) => (finishLoad = resolve)));
		const { createClient } = await import('../../src/client');
		const client = createClient();
		const loading = client.load();
		const disposing = client.dispose();
		const bundle = {
			model: { id: 'late-model' },
			processor: { id: 'late-processor' },
			label: 'Late Candidate'
		};
		finishLoad(bundle);

		await expect(loading).rejects.toMatchObject({ name: 'ClientDisposedError' });
		await disposing;
		expect(disposeModelBundleMock).toHaveBeenCalledWith(bundle);
		expect(client.getLoadedModelLabel()).toBeNull();
	});

	it('waits for in-flight inference before disposing its model', async () => {
		loadModelBundleMock.mockResolvedValue({
			model: { id: 'mock-model' },
			processor: { id: 'mock-processor' },
			label: 'Mock Candidate'
		});
		let finishInference!: () => void;
		removeBackgroundWithModelMock.mockReturnValue(
			new Promise((resolve) => {
				finishInference = () =>
					resolve({ canvas: document.createElement('canvas'), width: 1, height: 1 });
			})
		);
		const { createClient } = await import('../../src/client');
		const client = createClient();
		const removing = client.remove(new Blob(['x']));
		await vi.waitFor(() => expect(removeBackgroundWithModelMock).toHaveBeenCalledTimes(1));
		const disposing = client.dispose();
		await Promise.resolve();
		expect(disposeModelBundleMock).not.toHaveBeenCalled();

		finishInference();
		await removing;
		await disposing;
		expect(disposeModelBundleMock).toHaveBeenCalledTimes(1);
	});

	it('drains started batch work before rejecting or disposing the model', async () => {
		loadModelBundleMock.mockResolvedValue({
			model: { id: 'mock-model' },
			processor: { id: 'mock-processor' },
			label: 'Mock Candidate'
		});
		let failFirst!: (error: Error) => void;
		let finishSecond!: () => void;
		removeBackgroundWithModelMock
			.mockReturnValueOnce(new Promise((_, reject) => (failFirst = reject)))
			.mockReturnValueOnce(
				new Promise((resolve) => {
					finishSecond = () =>
						resolve({ canvas: document.createElement('canvas'), width: 1, height: 1 });
				})
			);

		const { createClient } = await import('../../src/client');
		const client = createClient();
		const removing = client.removeMany(
			[new Blob(['a']), new Blob(['b']), new Blob(['c'])],
			undefined,
			{ concurrency: 2 }
		);
		const rejection = expect(removing).rejects.toThrow('first item failed');
		await vi.waitFor(() => expect(removeBackgroundWithModelMock).toHaveBeenCalledTimes(2));

		failFirst(new Error('first item failed'));
		await Promise.resolve();
		const disposing = client.dispose();
		await Promise.resolve();
		expect(disposeModelBundleMock).not.toHaveBeenCalled();
		expect(removeBackgroundWithModelMock).toHaveBeenCalledTimes(2);

		finishSecond();
		await rejection;
		await disposing;
		expect(removeBackgroundWithModelMock).toHaveBeenCalledTimes(2);
		expect(disposeModelBundleMock).toHaveBeenCalledTimes(1);
	});

	it('rejects unsafe batch limits and concurrency values', async () => {
		const { createClient } = await import('../../src/client');
		const client = createClient({ performance: { maxBatchSize: 1 } });
		await expect(client.removeMany([new Blob(['a']), new Blob(['b'])])).rejects.toBeInstanceOf(
			RangeError
		);
		await expect(
			client.removeMany([new Blob(['a'])], undefined, { concurrency: Number.POSITIVE_INFINITY })
		).rejects.toBeInstanceOf(TypeError);
		await client.dispose();
	});
});
