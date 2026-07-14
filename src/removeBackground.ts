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
const pendingDisposals = new Set<Promise<void>>();

function scheduleDisposal(client: ReturnType<typeof createClient>): Promise<void> {
	const disposal = client.dispose();
	pendingDisposals.add(disposal);
	void disposal
		.catch(() => undefined)
		.finally(() => pendingDisposals.delete(disposal));
	return disposal;
}

function getSingletonClient(config?: ClientConfig): ReturnType<typeof createClient> {
	const signature = getClientConfigSignature(config);
	if (!singletonClient || singletonConfigSignature !== signature) {
		const previousClient = singletonClient;
		singletonClient = createClient(config);
		singletonConfigSignature = signature;
		if (previousClient) void scheduleDisposal(previousClient);
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

export async function disposeDefaultClient(): Promise<void> {
	const client = singletonClient;
	singletonClient = null;
	singletonConfigSignature = '';
	if (client) void scheduleDisposal(client);
	const disposals = [...pendingDisposals];
	if (disposals.length === 0) return;
	const results = await Promise.allSettled(disposals);
	const failures = results
		.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
		.map((result) => result.reason);
	if (failures.length > 0) {
		throw new AggregateError(failures, 'One or more background-removal clients failed to dispose.');
	}
}

export async function load(options?: LoadOptions, config?: ClientConfig): Promise<void> {
	return await loadModel(options, config);
}

export async function dispose(): Promise<void> {
	await disposeDefaultClient();
}
