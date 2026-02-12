import { describe, expect, it } from 'vitest';

import { getCandidates, resolveModelConfig } from '../../src/model';

describe('model strategy and config resolution', () => {
	it('applies default model configuration', () => {
		const resolved = resolveModelConfig();
		expect(resolved.modelId).toBe('briaai/RMBG-1.4');
		expect(resolved.revision).toBe('main');
		expect(resolved.strategy).toBe('auto');
	});

	it('uses forced webgpu strategy when specified', () => {
		const resolved = resolveModelConfig({
			model: {
				strategy: 'webgpu-fp16',
				modelId: 'custom/model'
			}
		});
		const candidates = getCandidates(resolved);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			modelId: 'custom/model',
			device: 'webgpu',
			dtype: 'fp16'
		});
	});

	it('uses explicit candidate list over strategy defaults', () => {
		const resolved = resolveModelConfig({
			model: {
				candidates: [
					{
						modelId: 'override/model',
						device: 'wasm',
						dtype: 'q8',
						label: 'manual'
					}
				]
			}
		});
		const candidates = getCandidates(resolved);
		expect(candidates).toEqual([
			{
				modelId: 'override/model',
				device: 'wasm',
				dtype: 'q8',
				label: 'manual'
			}
		]);
	});
});
