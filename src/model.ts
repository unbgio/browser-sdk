import { AutoModel, AutoProcessor, env, type Processor, type PreTrainedModel, type ProgressInfo } from '@huggingface/transformers';

import {
	DEFAULT_HF_REMOTE_HOST,
	DEFAULT_MODEL_ID,
	DEFAULT_MODEL_LOCAL_PATH,
	DEFAULT_MODEL_REMOTE_PATH_TEMPLATE,
	DEFAULT_MODEL_REVISION
} from './constants';
import { resolveClientConfig } from './config';
import { detectDeviceProfile } from './device';
import { ModelLoadError } from './errors';
import type { ClientConfig, ModelCandidateConfig, ModelConfig, ModelLoadProgress } from './types';

interface LoadedModelBundle {
	model: PreTrainedModel;
	processor: Processor;
	label: string;
}

interface ResolvedModelConfig {
	modelId: string;
	revision: string;
	strategy: NonNullable<ModelConfig['strategy']>;
	candidates?: ModelCandidateConfig[];
}

export function resolveModelConfig(config?: ClientConfig): ResolvedModelConfig {
	const resolved = resolveClientConfig(config);
	return {
		modelId: resolved.model?.modelId ?? DEFAULT_MODEL_ID,
		revision: resolved.model?.revision ?? DEFAULT_MODEL_REVISION,
		strategy: resolved.model?.strategy ?? 'auto',
		candidates: resolved.model?.candidates
	};
}

export function getCandidates(modelConfig: ResolvedModelConfig): ModelCandidateConfig[] {
	if (modelConfig.candidates && modelConfig.candidates.length > 0) {
		return modelConfig.candidates;
	}

	if (modelConfig.strategy === 'webgpu-fp16') {
		return [
			{
				modelId: modelConfig.modelId,
				device: 'webgpu',
				dtype: 'fp16',
				label: 'Forced WebGPU fp16'
			}
		];
	}

	if (modelConfig.strategy === 'wasm-q8') {
		return [
			{
				modelId: modelConfig.modelId,
				device: 'wasm',
				dtype: 'q8',
				label: 'Forced WASM q8'
			}
		];
	}

	const { hasWebGPU, isMobile, isWeakDevice } = detectDeviceProfile();
	const shouldUseMobileOrWeakStrategy = isMobile || isWeakDevice;

	if (!shouldUseMobileOrWeakStrategy) {
		return [
			{
				modelId: modelConfig.modelId,
				device: 'webgpu',
				dtype: 'fp16',
				label: 'WebGPU fp16 (desktop default)'
			},
			{
				modelId: modelConfig.modelId,
				device: 'wasm',
				dtype: 'q8',
				label: 'WASM q8 (desktop fallback)'
			}
		];
	}

	if (hasWebGPU) {
		return [
			{
				modelId: modelConfig.modelId,
				device: 'webgpu',
				dtype: 'fp16',
				label: 'WebGPU fp16 (mobile/weak default)'
			},
			{
				modelId: modelConfig.modelId,
				device: 'wasm',
				dtype: 'q8',
				label: 'WASM q8 (mobile/weak fallback)'
			}
		];
	}

	return [
		{
			modelId: modelConfig.modelId,
			device: 'wasm',
			dtype: 'q8',
			label: 'WASM q8 (mobile/weak default)'
		}
	];
}

export function configureTransformerRuntime(config?: ClientConfig): void {
	const resolved = resolveClientConfig(config);
	env.useBrowserCache = resolved.runtime?.useBrowserCache ?? true;
	env.allowLocalModels = resolved.runtime?.allowLocalModels ?? false;
	env.allowRemoteModels = resolved.runtime?.allowRemoteModels ?? true;
	env.localModelPath = resolved.runtime?.localModelPath ?? DEFAULT_MODEL_LOCAL_PATH;
	env.remoteHost = resolved.runtime?.remoteHost ?? DEFAULT_HF_REMOTE_HOST;
	env.remotePathTemplate = resolved.runtime?.remotePathTemplate ?? DEFAULT_MODEL_REMOTE_PATH_TEMPLATE;
}

export async function loadModelBundle(
	config: ClientConfig | undefined,
	onProgress?: (progress: ModelLoadProgress) => void
): Promise<LoadedModelBundle> {
	const modelConfig = resolveModelConfig(config);
	const candidates = getCandidates(modelConfig);
	const progressByFile = new Map<string, number>();
	let lastError: unknown = null;

	const computeAggregateProgress = (): number => {
		if (progressByFile.size === 0) return 0;
		let sum = 0;
		for (const value of progressByFile.values()) sum += value;
		return sum / progressByFile.size;
	};

	const progressCallback = (info: ProgressInfo): void => {
		if (!onProgress || info.status !== 'progress') return;
		if (info.file) {
			const point = info.progress ?? (info.total ? (info.loaded / info.total) * 100 : 0);
			progressByFile.set(info.file, Math.max(0, Math.min(100, point)));
		}
		onProgress({
			status: info.status,
			file: info.file,
			progress: computeAggregateProgress(),
			loaded: info.loaded,
			total: info.total
		});
	};

	for (const candidate of candidates) {
		try {
			const [modelResult, processorResult] = await Promise.allSettled([
				AutoModel.from_pretrained(candidate.modelId, {
					device: candidate.device,
					dtype: candidate.dtype,
					subfolder: 'onnx',
					revision: modelConfig.revision,
					progress_callback: progressCallback
				}),
				AutoProcessor.from_pretrained(candidate.modelId, {
					revision: modelConfig.revision,
					progress_callback: progressCallback
				})
			]);

			if (modelResult.status === 'rejected' || processorResult.status === 'rejected') {
				if (modelResult.status === 'rejected') {
					throw modelResult.reason;
				}
				if (processorResult.status === 'rejected') {
					throw processorResult.reason;
				}
				throw new Error('Unknown model bundle load failure.');
			}

			return {
				model: modelResult.value,
				processor: processorResult.value,
				label: candidate.label
			};
		} catch (error) {
			lastError = error;
		}
	}

	throw new ModelLoadError(
		lastError instanceof Error
			? `Failed to load model bundle: ${lastError.message}`
			: 'Failed to load model bundle'
	);
}
