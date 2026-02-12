import { describe, expect, it, vi } from 'vitest';

import { canvasToBlob, canvasToBlobUrl, isWebGPUAvailable, renderWithBackground, revokeBlobUrl } from '../../src/utils';

describe('utils', () => {
	it('checks webgpu availability', () => {
		const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
		Object.defineProperty(globalThis, 'navigator', {
			value: { gpu: {} },
			configurable: true
		});
		expect(isWebGPUAvailable()).toBe(true);

		if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
	});

	it('creates blob and blob URL from canvas', async () => {
		const canvas = document.createElement('canvas');
		const toBlobSpy = vi.spyOn(canvas, 'toBlob').mockImplementation((cb: BlobCallback) => {
			cb(new Blob(['ok'], { type: 'image/png' }));
		});
		const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mocked');

		const blob = await canvasToBlob(canvas);
		expect(blob).toBeInstanceOf(Blob);
		const url = await canvasToBlobUrl(canvas);
		expect(url).toBe('blob:mocked');
		expect(toBlobSpy).toHaveBeenCalled();
		expect(createObjectURLSpy).toHaveBeenCalled();

		toBlobSpy.mockRestore();
		createObjectURLSpy.mockRestore();
	});

	it('renders a canvas on custom background and revokes URL', () => {
		const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
			return {
				fillStyle: '',
				fillRect: () => undefined,
				drawImage: () => undefined
			} as unknown as CanvasRenderingContext2D;
		});
		const src = document.createElement('canvas');
		src.width = 8;
		src.height = 8;
		const out = renderWithBackground(src, '#fff');
		expect(out.width).toBe(8);
		expect(out.height).toBe(8);

		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		revokeBlobUrl('blob:test');
		expect(revokeSpy).toHaveBeenCalledWith('blob:test');
		revokeSpy.mockRestore();
		getContextSpy.mockRestore();
	});
});
