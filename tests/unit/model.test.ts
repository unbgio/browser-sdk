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

	it('disposes partially loaded candidate resources when its peer fails', async () => {
		const modelDispose = vi.fn().mockResolvedValue(undefined);
		autoModelFromPretrained.mockResolvedValue({ id: 'partial-model', dispose: modelDispose });
		autoProcessorFromPretrained.mockRejectedValue(new Error('processor failed'));
		const { loadModelBundle } = await import('../../src/model');

		await expect(loadModelBundle({ model: { strategy: 'wasm-q8' } })).rejects.toMatchObject({
			name: 'ModelLoadError'
		});
		expect(modelDispose).toHaveBeenCalledTimes(1);
	});

	it('awaits model and processor disposal', async () => {
		const modelDispose = vi.fn().mockResolvedValue(undefined);
		const processorDispose = vi.fn().mockResolvedValue(undefined);
		const { disposeModelBundle } = await import('../../src/model');

		await disposeModelBundle({
			model: { dispose: modelDispose } as never,
			processor: { dispose: processorDispose } as never
		});
		expect(modelDispose).toHaveBeenCalledTimes(1);
		expect(processorDispose).toHaveBeenCalledTimes(1);
	});

	it('serializes model downloads while applying each client runtime config', async () => {
		let finishFirst!: (value: { id: string }) => void;
		autoModelFromPretrained
			.mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)))
			.mockResolvedValueOnce({ id: 'second-model' });
		autoProcessorFromPretrained.mockResolvedValue({ id: 'processor' });
		const { loadModelBundle } = await import('../../src/model');

		const first = loadModelBundle({
			model: { strategy: 'wasm-q8' },
			runtime: { remoteHost: 'https://first.example.com' }
		});
		await vi.waitFor(() => expect(autoModelFromPretrained).toHaveBeenCalledTimes(1));
		const second = loadModelBundle({
			model: { strategy: 'wasm-q8' },
			runtime: { remoteHost: 'https://second.example.com' }
		});
		await Promise.resolve();

		expect(autoModelFromPretrained).toHaveBeenCalledTimes(1);
		expect(mockedEnv.remoteHost).toBe('https://first.example.com');
		finishFirst({ id: 'first-model' });
		await first;
		await vi.waitFor(() => expect(autoModelFromPretrained).toHaveBeenCalledTimes(2));
		expect(mockedEnv.remoteHost).toBe('https://second.example.com');
		await second;
	});
});
