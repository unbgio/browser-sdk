import { describe, expect, it } from 'vitest';

import { UnsupportedInputError } from '../../src/errors';
import { normalizeInput } from '../../src/input';

describe('normalizeInput error handling', () => {
	it('throws for unsupported inputs', async () => {
		await expect(normalizeInput(123 as never)).rejects.toBeInstanceOf(UnsupportedInputError);
	});
});
