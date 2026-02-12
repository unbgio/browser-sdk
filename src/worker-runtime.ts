import { createClient } from './client';
import type {
	BatchProcessOptions,
	ClientConfig,
	WorkerRemovePayload,
	WorkerRequest,
	WorkerResponse
} from './types';

interface WorkerScope {
	postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
	onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

function toBitmapPayload(result: { canvas: HTMLCanvasElement; width: number; height: number }): Promise<WorkerRemovePayload> {
	const runtimeCanvas = result.canvas as unknown as {
		transferToImageBitmap?: () => ImageBitmap;
		convertToBlob?: (options?: { type?: string; quality?: number }) => Promise<Blob>;
	};

	if (runtimeCanvas.transferToImageBitmap) {
		return Promise.resolve({
			bitmap: runtimeCanvas.transferToImageBitmap(),
			width: result.width,
			height: result.height
		});
	}

	if (runtimeCanvas.convertToBlob && typeof createImageBitmap !== 'undefined') {
		return runtimeCanvas.convertToBlob({ type: 'image/png' }).then(async (blob) => ({
			bitmap: await createImageBitmap(blob),
			width: result.width,
			height: result.height
		}));
	}

	return Promise.reject(new Error('Unable to convert worker result into ImageBitmap.'));
}

export function attachWorkerRuntime(scope: WorkerScope, config?: ClientConfig): void {
	const client = createClient(config);

	scope.onmessage = async (event) => {
		const request = event.data;

		try {
			if (request.type === 'load') {
				await client.load(request.options);
				scope.postMessage({ requestId: request.requestId, ok: true });
				return;
			}

			if (request.type === 'remove') {
				const result = await client.remove(request.input, request.options);
				const payload = await toBitmapPayload(result);
				scope.postMessage({ requestId: request.requestId, ok: true, result: payload }, [payload.bitmap]);
				return;
			}

			if (request.type === 'removeMany') {
				const results = await client.removeMany(
					request.inputs,
					request.options,
					request.batchOptions as BatchProcessOptions | undefined
				);
				const payloads = await Promise.all(results.map(toBitmapPayload));
				scope.postMessage(
					{ requestId: request.requestId, ok: true, results: payloads },
					payloads.map((item) => item.bitmap)
				);
				return;
			}

			if (request.type === 'getLoadedModelLabel') {
				scope.postMessage({
					requestId: request.requestId,
					ok: true,
					label: client.getLoadedModelLabel()
				});
				return;
			}

			if (request.type === 'dispose') {
				client.dispose();
				scope.postMessage({ requestId: request.requestId, ok: true });
				return;
			}
		} catch (error) {
			scope.postMessage({
				requestId: request.requestId,
				ok: false,
				error: error instanceof Error ? error.message : 'Unknown worker runtime error'
			});
		}
	};
}
