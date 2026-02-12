import { beforeEach, describe, expect, it, vi } from 'vitest';

const autoModelFromPretrained = vi.fn();
const autoProcessorFromPretrained = vi.fn();
const mockedEnv = {
	useBrowserCache: false,
	allowLocalModels: false,
	allowRemoteModels: true,
	localModelPath: '',
	remotePathTemplate: '',
	remoteHost: ''
};

vi.mock('@huggingface/transformers', () => ({
	AutoModel: { from_pretrained: autoModelFromPretrained },
	AutoProcessor: { from_pretrained: autoProcessorFromPretrained },
	env: mockedEnv
}));

describe('model runtime and loading', () => {
	beforeEach(() => {
		autoModelFromPretrained.mockReset();
		autoProcessorFromPretrained.mockReset();
	});

	it('configures transformers runtime defaults and overrides', async () => {
		const { configureTransformerRuntime } = await import('../../src/model');
		configureTransformerRuntime({
			runtime: {
				useBrowserCache: false,
				allowLocalModels: true,
				allowRemoteModels: false,
				localModelPath: '/tmp/models',
				remotePathTemplate: '/x/{model}/{revision}',
				remoteHost: 'https://cdn.example.com'
			}
		});

		expect(mockedEnv.useBrowserCache).toBe(false);
		expect(mockedEnv.allowLocalModels).toBe(true);
		expect(mockedEnv.allowRemoteModels).toBe(false);
		expect(mockedEnv.localModelPath).toBe('/tmp/models');
		expect(mockedEnv.remotePathTemplate).toBe('/x/{model}/{revision}');
		expect(mockedEnv.remoteHost).toBe('https://cdn.example.com');
	});

	it('loads model bundle and reports progress', async () => {
		const { loadModelBundle } = await import('../../src/model');
		autoModelFromPretrained.mockImplementation(
			async (_modelId: string, options: { progress_callback?: (progress: any) => void }) => {
				options.progress_callback?.({
					status: 'progress',
					file: 'model.onnx',
					loaded: 50,
					total: 100
				});
				return { id: 'm' };
			}
		);
		autoProcessorFromPretrained.mockResolvedValue({ id: 'p' });

		const progressSpy = vi.fn();
		const loaded = await loadModelBundle(
			{
				model: { strategy: 'wasm-q8' }
			},
			progressSpy
		);

		expect(loaded.label).toContain('WASM');
		expect(loaded.model).toEqual({ id: 'm' });
		expect(loaded.processor).toEqual({ id: 'p' });
		expect(progressSpy).toHaveBeenCalled();
	});

	it('throws model load error when all candidates fail', async () => {
		const { loadModelBundle } = await import('../../src/model');
		autoModelFromPretrained.mockRejectedValue(new Error('boom'));
		autoProcessorFromPretrained.mockRejectedValue(new Error('boom'));
		await expect(loadModelBundle({ model: { strategy: 'wasm-q8' } })).rejects.toMatchObject({
			name: 'ModelLoadError'
		});
	});
});
