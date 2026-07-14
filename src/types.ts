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
	maxInputBytes?: number;
	maxInputPixels?: number;
	maxBatchSize?: number;
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
	/** @deprecated Encode the returned canvas with canvasToBlob() or canvasToBlobUrl(). */
	output?: RemoveOutputOptions;
	/** Cancels caller-side preprocessing or a pending worker request. */
	signal?: AbortSignal;
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
	/** Worker-safe configuration. Function hooks cannot be structured-cloned. */
	config?: WorkerRuntimeConfig;
	mode?: WorkerExecutionMode;
	workerFactory?: () => Worker;
	/** Maximum time to wait for a worker RPC response. Defaults to 10 minutes. */
	requestTimeoutMs?: number;
}

export type WorkerRuntimeConfig = Omit<ClientConfig, 'hooks'>;

export interface WorkerRuntimeScope {
	postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

export type WorkerRequestType = 'initialize' | 'load' | 'remove' | 'removeMany' | 'dispose';

export interface WorkerRequestBase {
	requestId: string;
	type: WorkerRequestType;
}

export interface WorkerInitializeRequest extends WorkerRequestBase {
	type: 'initialize';
	config?: WorkerRuntimeConfig;
}

export interface WorkerLoadRequest extends WorkerRequestBase {
	type: 'load';
}

export interface WorkerRemoveRequest extends WorkerRequestBase {
	type: 'remove';
	input: Exclude<RemoveBackgroundInput, HTMLImageElement | HTMLCanvasElement>;
	options?: Omit<RemoveOptions, 'signal'>;
}

export interface WorkerRemoveManyRequest extends WorkerRequestBase {
	type: 'removeMany';
	inputs: Array<Exclude<RemoveBackgroundInput, HTMLImageElement | HTMLCanvasElement>>;
	options?: Omit<RemoveOptions, 'signal'>;
	batchOptions?: BatchProcessOptions;
}

export interface WorkerDisposeRequest extends WorkerRequestBase {
	type: 'dispose';
}

export type WorkerRequest =
	| WorkerInitializeRequest
	| WorkerLoadRequest
	| WorkerRemoveRequest
	| WorkerRemoveManyRequest
	| WorkerDisposeRequest;

export interface WorkerRemovePayload {
	bitmap: ImageBitmap;
	width: number;
	height: number;
}

export interface WorkerResponse {
	type: 'response';
	requestId: string;
	ok: boolean;
	error?: string;
	label?: string | null;
	result?: WorkerRemovePayload;
	results?: WorkerRemovePayload[];
}

export interface WorkerProgressMessage {
	type: 'progress';
	requestId: string;
	progress: ModelLoadProgress;
}

export type WorkerMessage = WorkerResponse | WorkerProgressMessage;
