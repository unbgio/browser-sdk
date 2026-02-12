import { createClient } from './client';
import { getClientConfigSignature } from './config';
import type {
	BatchProcessOptions,
	ClientConfig,
	LoadOptions,
	RemoveBackgroundInput,
	RemoveOptions,
	RemoveResult
} from './types';

let singletonClient: ReturnType<typeof createClient> | null = null;
let singletonConfigSignature = '';

function getSingletonClient(config?: ClientConfig): ReturnType<typeof createClient> {
	const signature = getClientConfigSignature(config);
	if (!singletonClient || singletonConfigSignature !== signature) {
		singletonClient = createClient(config);
		singletonConfigSignature = signature;
	}
	return singletonClient;
}

export async function removeBackground(
	input: RemoveBackgroundInput,
	options?: RemoveOptions,
	config?: ClientConfig
): Promise<RemoveResult> {
	const client = getSingletonClient(config);
	return await client.remove(input, options);
}

export async function removeMany(
	inputs: RemoveBackgroundInput[],
	options?: RemoveOptions,
	config?: ClientConfig,
	batchOptions?: BatchProcessOptions
): Promise<RemoveResult[]> {
	const client = getSingletonClient(config);
	return await client.removeMany(inputs, options, batchOptions);
}

export async function loadModel(options?: LoadOptions, config?: ClientConfig): Promise<void>;
export async function loadModel(
	onProgress?: LoadOptions['onProgress'],
	config?: ClientConfig
): Promise<void>;
export async function loadModel(
	optionsOrProgress?: LoadOptions | LoadOptions['onProgress'],
	config?: ClientConfig
): Promise<void> {
	const options =
		typeof optionsOrProgress === 'function' ? { onProgress: optionsOrProgress } : optionsOrProgress;
	const client = getSingletonClient(config);
	await client.load(options);
}

export function getLoadedModelLabel(config?: ClientConfig): string | null {
	const client = getSingletonClient(config);
	return client.getLoadedModelLabel();
}

export function disposeDefaultClient(): void {
	if (!singletonClient) return;
	singletonClient.dispose();
	singletonClient = null;
	singletonConfigSignature = '';
}

export async function load(options?: LoadOptions, config?: ClientConfig): Promise<void> {
	return await loadModel(options, config);
}

export function dispose(): void {
	disposeDefaultClient();
}
