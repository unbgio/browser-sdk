import { describe, expect, it } from 'vitest';

import { getInferenceSize } from '../../src/pipeline';

describe('getInferenceSize', () => {
	it('keeps dimensions when within max budget', () => {
		const size = getInferenceSize(1000, 1000, 1_048_576, 2_073_600, false);
		expect(size).toEqual({ width: 1000, height: 1000 });
	});

	it('scales down while preserving aspect ratio', () => {
		const size = getInferenceSize(4000, 2000, 1_048_576, 2_073_600, false);
		expect(size.width).toBeLessThan(4000);
		expect(size.height).toBeLessThan(2000);
		expect(size.width / size.height).toBeCloseTo(2, 1);
	});

	it('uses mobile threshold when mobile flag is true', () => {
		const desktop = getInferenceSize(1800, 1200, 1_048_576, 2_073_600, false);
		const mobile = getInferenceSize(1800, 1200, 1_048_576, 2_073_600, true);
		expect(mobile.width * mobile.height).toBeLessThan(desktop.width * desktop.height);
	});
});
