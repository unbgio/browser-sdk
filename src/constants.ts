import type { ClientConfig, ClientPreset } from './types';

export const DEFAULT_MODEL_REMOTE_PATH_TEMPLATE = '/{model}/resolve/{revision}/';
export const DEFAULT_HF_REMOTE_HOST = 'https://huggingface.co';
export const DEFAULT_MODEL_LOCAL_PATH = '/local-models/';
export const DEFAULT_MODEL_ID = 'briaai/RMBG-1.4';
export const DEFAULT_MODEL_REVISION = 'main';
export const DEFAULT_MOBILE_MAX_INFERENCE_PIXELS = 1024 * 1024;
export const DEFAULT_DESKTOP_MAX_INFERENCE_PIXELS = 1920 * 1080;
export const DEFAULT_ALPHA_APPLY_CHUNK_ROWS = 256;

export const DEFAULT_CLIENT_CONFIG: Required<Omit<ClientConfig, 'hooks' | 'preset'>> = {
	model: {
		modelId: DEFAULT_MODEL_ID,
		revision: DEFAULT_MODEL_REVISION,
		strategy: 'auto'
	},
	runtime: {
		useBrowserCache: true,
		allowLocalModels: false,
		allowRemoteModels: true,
		localModelPath: DEFAULT_MODEL_LOCAL_PATH,
		remoteHost: DEFAULT_HF_REMOTE_HOST,
		remotePathTemplate: DEFAULT_MODEL_REMOTE_PATH_TEMPLATE
	},
	performance: {
		mobileMaxInferencePixels: DEFAULT_MOBILE_MAX_INFERENCE_PIXELS,
		desktopMaxInferencePixels: DEFAULT_DESKTOP_MAX_INFERENCE_PIXELS,
		alphaApplyChunkRows: DEFAULT_ALPHA_APPLY_CHUNK_ROWS
	}
};

export const CLIENT_PRESETS: Record<ClientPreset, ClientConfig> = {
	'fast-mobile': {
		model: {
			strategy: 'wasm-q8'
		},
		performance: {
			mobileMaxInferencePixels: 768 * 768,
			desktopMaxInferencePixels: 1280 * 720,
			alphaApplyChunkRows: 128
		}
	},
	'quality-desktop': {
		model: {
			strategy: 'webgpu-fp16'
		},
		performance: {
			mobileMaxInferencePixels: DEFAULT_MOBILE_MAX_INFERENCE_PIXELS,
			desktopMaxInferencePixels: 2560 * 1440,
			alphaApplyChunkRows: 384
		}
	}
};
