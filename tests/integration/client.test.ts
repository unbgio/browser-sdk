import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadModelBundleMock = vi.fn();
const configureTransformerRuntimeMock = vi.fn();
const removeBackgroundWithModelMock = vi.fn();

vi.mock('../../src/model', () => ({
	loadModelBundle: loadModelBundleMock,
	configureTransformerRuntime: configureTransformerRuntimeMock
}));

vi.mock('../../src/pipeline', () => ({
	removeBackgroundWithModel: removeBackgroundWithModelMock
}));

describe('client API', () => {
	beforeEach(() => {
		loadModelBundleMock.mockReset();
		configureTransformerRuntimeMock.mockReset();
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
});
