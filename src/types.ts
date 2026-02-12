export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ModelLoadProgress {
	status: string;
	file?: string;
	progress?: number;
	loaded?: number;
	total?: number;
}

export type RuntimeDevice = 'webgpu' | 'wasm';
export type ModelDtype = 'fp16' | 'fp32' | 'q8';
export type ModelStrategy = 'auto' | 'webgpu-fp16' | 'wasm-q8';
export type ClientPreset = 'fast-mobile' | 'quality-desktop';
export type WorkerExecutionMode = 'auto' | 'worker' | 'main-thread';

export interface ModelCandidateConfig {
	modelId: string;
	device: RuntimeDevice;
	dtype: ModelDtype;
	label: string;
}

export interface RuntimeConfig {
	useBrowserCache?: boolean;
	allowLocalModels?: boolean;
	allowRemoteModels?: boolean;
	localModelPath?: string;
	remoteHost?: string;
	remotePathTemplate?: string;
}

export interface ModelConfig {
	modelId?: string;
	revision?: string;
	strategy?: ModelStrategy;
	candidates?: ModelCandidateConfig[];
}

export interface PerformanceConfig {
	mobileMaxInferencePixels?: number;
	desktopMaxInferencePixels?: number;
	alphaApplyChunkRows?: number;
}

export interface ClientConfig {
	preset?: ClientPreset;
	model?: ModelConfig;
	runtime?: RuntimeConfig;
	performance?: PerformanceConfig;
	hooks?: PipelineHooks;
}

export type RemoveBackgroundInput =
	| string
	| Blob
	| File
	| HTMLImageElement
	| ImageBitmap
	| HTMLCanvasElement;

export interface RemoveOutputOptions {
	type?: string;
	quality?: number;
}

export interface RemoveOptions {
	background?: 'transparent' | string;
	output?: RemoveOutputOptions;
}

export interface RemoveResult {
	canvas: HTMLCanvasElement;
	width: number;
	height: number;
}

export interface LoadOptions {
	onProgress?: (progress: ModelLoadProgress) => void;
}

export interface BatchProcessOptions {
	concurrency?: number;
}

export interface TelemetryEvent {
	type:
		| 'load:start'
		| 'load:success'
		| 'load:error'
		| 'remove:start'
		| 'remove:success'
		| 'remove:error'
		| 'removeMany:start'
		| 'removeMany:success'
		| 'removeMany:error';
	timestamp: number;
	durationMs?: number;
	detail?: string;
}

export interface PipelineHooks {
	beforeProcess?: (input: RemoveBackgroundInput, options?: RemoveOptions) => RemoveBackgroundInput | Promise<RemoveBackgroundInput>;
	afterProcess?: (
		result: RemoveResult,
		context: { input: RemoveBackgroundInput; options?: RemoveOptions }
	) => void | Promise<void>;
	telemetry?: (event: TelemetryEvent) => void;
}

export interface WorkerClientOptions {
	config?: ClientConfig;
	mode?: WorkerExecutionMode;
	workerFactory?: () => Worker;
}

export type WorkerRequestType = 'load' | 'remove' | 'removeMany' | 'getLoadedModelLabel' | 'dispose';

export interface WorkerRequestBase {
	requestId: string;
	type: WorkerRequestType;
}

export interface WorkerLoadRequest extends WorkerRequestBase {
	type: 'load';
	options?: LoadOptions;
}

export interface WorkerRemoveRequest extends WorkerRequestBase {
	type: 'remove';
	input: Exclude<RemoveBackgroundInput, HTMLImageElement | HTMLCanvasElement>;
	options?: RemoveOptions;
}

export interface WorkerRemoveManyRequest extends WorkerRequestBase {
	type: 'removeMany';
	inputs: Array<Exclude<RemoveBackgroundInput, HTMLImageElement | HTMLCanvasElement>>;
	options?: RemoveOptions;
	batchOptions?: BatchProcessOptions;
}

export interface WorkerGetLoadedModelLabelRequest extends WorkerRequestBase {
	type: 'getLoadedModelLabel';
}

export interface WorkerDisposeRequest extends WorkerRequestBase {
	type: 'dispose';
}

export type WorkerRequest =
	| WorkerLoadRequest
	| WorkerRemoveRequest
	| WorkerRemoveManyRequest
	| WorkerGetLoadedModelLabelRequest
	| WorkerDisposeRequest;

export interface WorkerRemovePayload {
	bitmap: ImageBitmap;
	width: number;
	height: number;
}

export interface WorkerResponse {
	requestId: string;
	ok: boolean;
	error?: string;
	label?: string | null;
	result?: WorkerRemovePayload;
	results?: WorkerRemovePayload[];
}
