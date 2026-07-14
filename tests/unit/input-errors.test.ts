import { describe, expect, it } from 'vitest';

import { ResourceLimitError, UnsupportedInputError } from '../../src/errors';
import { normalizeInput } from '../../src/input';

describe('normalizeInput error handling', () => {
	it('throws for unsupported inputs', async () => {
		await expect(normalizeInput(123 as never)).rejects.toBeInstanceOf(UnsupportedInputError);
	});

	it('rejects oversized blobs before decoding', async () => {
		await expect(
			normalizeInput(new Blob(['too large']), { maxInputBytes: 2, maxInputPixels: 100 })
		).rejects.toBeInstanceOf(ResourceLimitError);
	});

	it('honors a signal that is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			normalizeInput(new Blob(['x']), {
				maxInputBytes: 100,
				maxInputPixels: 100,
				signal: controller.signal
			})
		).rejects.toMatchObject({ name: 'AbortError' });
	});
});
