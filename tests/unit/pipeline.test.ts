import { beforeEach, describe, expect, it, vi } from 'vitest';

const normalizeInputMock = vi.fn();
const detectDeviceProfileMock = vi.fn();
const fromTensorMock = vi.fn();

vi.mock('../../src/input', () => ({
	normalizeInput: normalizeInputMock
}));

vi.mock('../../src/device', () => ({
	detectDeviceProfile: detectDeviceProfileMock
}));

vi.mock('@huggingface/transformers', () => ({
	RawImage: {
		fromTensor: fromTensorMock
	}
}));

function createTensorChain() {
	const chain: any = {
		min: () => ({ item: () => 0 }),
		max: () => ({ item: () => 1 }),
		mul_: () => chain,
		add_: () => chain,
		round_: () => chain,
		to: () => chain,
		unsqueeze: () => chain,
		sub: () => chain,
		div_: () => chain
	};
	return chain;
}

describe('removeBackgroundWithModel', () => {
	beforeEach(() => {
		normalizeInputMock.mockReset();
		detectDeviceProfileMock.mockReset();
		fromTensorMock.mockReset();
	});

	it('processes image and applies optional background', async () => {
		const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
			() =>
				({
					fillStyle: '',
					fillRect: () => undefined,
					drawImage: () => undefined,
					getImageData: (_x: number, _y: number, w: number, h: number) => ({
						data: new Uint8ClampedArray(w * h * 4)
					}),
					putImageData: () => undefined
				}) as unknown as CanvasRenderingContext2D
		);
		const cleanupSpy = vi.fn();
		normalizeInputMock.mockResolvedValue({
			rawImage: {
				width: 2,
				height: 2,
				resize: vi.fn().mockResolvedValue({ width: 2, height: 2 })
			},
			drawableImage: document.createElement('canvas'),
			cleanup: cleanupSpy
		});
		detectDeviceProfileMock.mockReturnValue({
			isMobile: false,
			isWeakDevice: false
		});
		fromTensorMock.mockReturnValue({
			resize: vi.fn().mockResolvedValue({
				data: new Uint8ClampedArray([255, 255, 255, 255])
			})
		});

		const processor = vi.fn().mockResolvedValue({ pixel_values: 'pixels' });
		const model = vi.fn().mockResolvedValue({
			output: [{ squeeze: () => createTensorChain() }]
		});

		const { removeBackgroundWithModel } = await import('../../src/pipeline');
		const result = await removeBackgroundWithModel(
			model as never,
			processor as never,
			undefined,
			'https://example.com/img.png',
			{ background: '#ffffff' }
		);

		expect(result.width).toBe(2);
		expect(result.height).toBe(2);
		expect(processor).toHaveBeenCalled();
		expect(model).toHaveBeenCalled();
		expect(cleanupSpy).toHaveBeenCalled();
		getContextSpy.mockRestore();
	});

	it('wraps inference failures as InferenceError and still cleans up', async () => {
		const cleanupSpy = vi.fn();
		normalizeInputMock.mockResolvedValue({
			rawImage: {
				width: 2,
				height: 2,
				resize: vi.fn().mockResolvedValue({ width: 2, height: 2 })
			},
			drawableImage: document.createElement('canvas'),
			cleanup: cleanupSpy
		});
		detectDeviceProfileMock.mockReturnValue({
			isMobile: false,
			isWeakDevice: false
		});
		const processor = vi.fn().mockRejectedValue(new Error('bad processor'));
		const model = vi.fn();

		const { removeBackgroundWithModel } = await import('../../src/pipeline');
		await expect(
			removeBackgroundWithModel(
				model as never,
				processor as never,
				undefined,
				'https://example.com/img.png'
			)
		).rejects.toMatchObject({ name: 'InferenceError' });
		expect(cleanupSpy).toHaveBeenCalled();
	});

	it('runs beforeProcess and afterProcess hooks', async () => {
		const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
			() =>
				({
					fillStyle: '',
					fillRect: () => undefined,
					drawImage: () => undefined,
					getImageData: (_x: number, _y: number, w: number, h: number) => ({
						data: new Uint8ClampedArray(w * h * 4)
					}),
					putImageData: () => undefined
				}) as unknown as CanvasRenderingContext2D
		);

		const cleanupSpy = vi.fn();
		normalizeInputMock.mockResolvedValue({
			rawImage: {
				width: 2,
				height: 2,
				resize: vi.fn().mockResolvedValue({ width: 2, height: 2 })
			},
			drawableImage: document.createElement('canvas'),
			cleanup: cleanupSpy
		});
		detectDeviceProfileMock.mockReturnValue({
			isMobile: false,
			isWeakDevice: false
		});
		fromTensorMock.mockReturnValue({
			resize: vi.fn().mockResolvedValue({
				data: new Uint8ClampedArray([255, 255, 255, 255])
			})
		});
		const beforeProcess = vi.fn(async (input: unknown) => `${String(input)}?hooked`);
		const afterProcess = vi.fn();
		const processor = vi.fn().mockResolvedValue({ pixel_values: 'pixels' });
		const model = vi.fn().mockResolvedValue({
			output: [{ squeeze: () => createTensorChain() }]
		});

		const { removeBackgroundWithModel } = await import('../../src/pipeline');
		await removeBackgroundWithModel(model as never, processor as never, {
			hooks: { beforeProcess, afterProcess }
		}, 'https://example.com/img.png');

		expect(beforeProcess).toHaveBeenCalledTimes(1);
		expect(afterProcess).toHaveBeenCalledTimes(1);
		expect(cleanupSpy).toHaveBeenCalled();
		getContextSpy.mockRestore();
	});
});
