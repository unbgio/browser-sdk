import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromURLMock = vi.fn();

vi.mock('@huggingface/transformers', () => ({
	RawImage: {
		fromURL: fromURLMock
	}
}));

class FakeImage {
	public crossOrigin = '';
	public onload: null | (() => void) = null;
	public onerror: null | (() => void) = null;
	private _src = '';

	set src(value: string) {
		this._src = value;
		queueMicrotask(() => {
			this.onload?.();
		});
	}

	get src(): string {
		return this._src;
	}

	get currentSrc(): string {
		return this._src;
	}
}

describe('normalizeInput', () => {
	beforeEach(() => {
		fromURLMock.mockReset();
		fromURLMock.mockResolvedValue({
			width: 4,
			height: 4
		});
		(globalThis as any).Image = FakeImage;
	});

	it('normalizes URL string input', async () => {
		const { normalizeInput } = await import('../../src/input');
		const normalized = await normalizeInput('https://example.com/x.png');
		expect(normalized.rawImage.width).toBe(4);
		expect(normalized.drawableImage).toBeTruthy();
		normalized.cleanup();
	});

	it('normalizes Blob input and revokes object URL on cleanup', async () => {
		const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		const { normalizeInput } = await import('../../src/input');

		const normalized = await normalizeInput(new Blob(['hello'], { type: 'text/plain' }));
		expect(createSpy).toHaveBeenCalled();
		normalized.cleanup();
		expect(revokeSpy).toHaveBeenCalledWith('blob:fake');

		createSpy.mockRestore();
		revokeSpy.mockRestore();
	});

	it('normalizes canvas input through toBlob', async () => {
		const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:canvas');
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		const canvas = document.createElement('canvas');
		vi.spyOn(canvas, 'toBlob').mockImplementation((cb: BlobCallback) => {
			cb(new Blob(['ok'], { type: 'image/png' }));
		});

		const { normalizeInput } = await import('../../src/input');
		const normalized = await normalizeInput(canvas);
		expect(normalized.rawImage.width).toBe(4);
		normalized.cleanup();
		expect(revokeSpy).toHaveBeenCalledWith('blob:canvas');

		createSpy.mockRestore();
		revokeSpy.mockRestore();
	});
});
