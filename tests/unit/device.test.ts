import { afterEach, describe, expect, it } from 'vitest';

import { detectDeviceProfile } from '../../src/device';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function setNavigator(value: Navigator | undefined): void {
	Object.defineProperty(globalThis, 'navigator', {
		value,
		configurable: true
	});
}

describe('detectDeviceProfile', () => {
	afterEach(() => {
		if (originalNavigator) {
			Object.defineProperty(globalThis, 'navigator', originalNavigator);
		} else {
			Reflect.deleteProperty(globalThis, 'navigator');
		}
	});

	it('returns weak profile when navigator is missing', () => {
		setNavigator(undefined);
		const profile = detectDeviceProfile();
		expect(profile).toEqual({
			hasWebGPU: false,
			isMobile: false,
			isWeakDevice: true
		});
	});

	it('detects mobile and weak cpu/memory', () => {
		setNavigator({
			gpu: {},
			userAgent: 'iPhone',
			hardwareConcurrency: 2,
			deviceMemory: 2
		} as Navigator & { gpu: unknown; deviceMemory: number });

		const profile = detectDeviceProfile();
		expect(profile.hasWebGPU).toBe(true);
		expect(profile.isMobile).toBe(true);
		expect(profile.isWeakDevice).toBe(true);
	});
});
