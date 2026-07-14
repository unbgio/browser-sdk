import { describe, expect, it } from 'vitest';

import { getClientConfigSignature, resolveClientConfig } from '../../src/config';

describe('config resolver', () => {
	it('applies top-level preset defaults', () => {
		const resolved = resolveClientConfig({ preset: 'fast-mobile' });
		expect(resolved.model?.strategy).toBe('wasm-q8');
		expect(resolved.performance?.alphaApplyChunkRows).toBe(128);
	});

	it('allows deep overrides on top of preset values', () => {
		const resolved = resolveClientConfig({
			preset: 'quality-desktop',
			performance: { alphaApplyChunkRows: 512 }
		});
		expect(resolved.model?.strategy).toBe('webgpu-fp16');
		expect(resolved.performance?.alphaApplyChunkRows).toBe(512);
	});

	it('generates deterministic signatures independent of key order', () => {
		const signatureA = getClientConfigSignature({
			model: { strategy: 'auto', revision: 'main' },
			runtime: { allowRemoteModels: true, useBrowserCache: true }
		});
		const signatureB = getClientConfigSignature({
			runtime: { useBrowserCache: true, allowRemoteModels: true },
			model: { revision: 'main', strategy: 'auto' }
		});
		expect(signatureA).toBe(signatureB);
	});

	it('includes hook identity in singleton signatures', () => {
		const firstHook = () => undefined;
		const secondHook = () => undefined;
		expect(getClientConfigSignature({ hooks: { telemetry: firstHook } })).toBe(
			getClientConfigSignature({ hooks: { telemetry: firstHook } })
		);
		expect(getClientConfigSignature({ hooks: { telemetry: firstHook } })).not.toBe(
			getClientConfigSignature({ hooks: { telemetry: secondHook } })
		);
	});

	it.each([
		{ preset: 'unknown' },
		{ model: { strategy: 'turbo' } },
		{ model: { candidates: [] } },
		{ runtime: { remoteHost: 'javascript:alert(1)' } },
		{ runtime: { remoteHost: 'https://user:password@example.com' } },
		{ hooks: { telemetry: 'not-a-function' } },
		{ performnce: { maxInputBytes: 1 } }
	])('rejects malformed configuration %#', (config) => {
		expect(() => resolveClientConfig(config as never)).toThrow(TypeError);
	});

	it('rejects prototype-mutating configuration keys', () => {
		const config = JSON.parse('{"model":{"__proto__":{"polluted":true}}}');
		expect(() => resolveClientConfig(config)).toThrow(TypeError);
		expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects unsafe numeric performance values (%s)',
		(value) => {
			expect(() =>
				resolveClientConfig({ performance: { alphaApplyChunkRows: value } })
			).toThrow(TypeError);
		}
	);
});
