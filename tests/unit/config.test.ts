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
});
