import { RawImage, type Processor, type PreTrainedModel } from '@huggingface/transformers';

import {
	DEFAULT_ALPHA_APPLY_CHUNK_ROWS,
	DEFAULT_DESKTOP_MAX_INFERENCE_PIXELS,
	DEFAULT_MOBILE_MAX_INFERENCE_PIXELS
} from './constants';
import { resolveClientConfig } from './config';
import { detectDeviceProfile } from './device';
import { InferenceError } from './errors';
import { normalizeInput } from './input';
import type { ClientConfig, RemoveOptions, RemoveResult } from './types';

export function getInferenceSize(
	width: number,
	height: number,
	mobileMaxInferencePixels: number,
	desktopMaxInferencePixels: number,
	isMobileOrWeak: boolean
): { width: number; height: number } {
	const maxPixels = isMobileOrWeak ? mobileMaxInferencePixels : desktopMaxInferencePixels;
	const totalPixels = width * height;
	if (totalPixels <= maxPixels) return { width, height };

	const scale = Math.sqrt(maxPixels / totalPixels);
	return {
		width: Math.max(1, Math.floor(width * scale)),
		height: Math.max(1, Math.floor(height * scale))
	};
}

async function yieldToMainThread(): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function createCanvas(width: number, height: number): AnyCanvas {
	if (typeof document !== 'undefined') {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
	if (typeof OffscreenCanvas !== 'undefined') {
		return new OffscreenCanvas(width, height);
	}
	throw new InferenceError('No canvas implementation available in this environment.');
}

function renderWithBackgroundForRuntime(sourceCanvas: AnyCanvas, bgColor: string): AnyCanvas {
	const canvas = createCanvas(sourceCanvas.width, sourceCanvas.height);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new InferenceError('Could not create rendering context.');
	ctx.fillStyle = bgColor;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(sourceCanvas as CanvasImageSource, 0, 0);
	return canvas;
}

function toHtmlCanvas(canvas: AnyCanvas): HTMLCanvasElement {
	if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
		return canvas;
	}
	if (typeof document === 'undefined') {
		return canvas as unknown as HTMLCanvasElement;
	}
	const htmlCanvas = document.createElement('canvas');
	htmlCanvas.width = canvas.width;
	htmlCanvas.height = canvas.height;
	const ctx = htmlCanvas.getContext('2d');
	if (!ctx) throw new InferenceError('Could not create output canvas context.');
	ctx.drawImage(canvas as CanvasImageSource, 0, 0);
	return htmlCanvas;
}

export async function removeBackgroundWithModel(
	model: PreTrainedModel,
	processor: Processor,
	config: ClientConfig | undefined,
	input: Parameters<typeof normalizeInput>[0],
	options?: RemoveOptions
): Promise<RemoveResult> {
	const resolvedConfig = resolveClientConfig(config);
	const processedInput = resolvedConfig.hooks?.beforeProcess
		? await resolvedConfig.hooks.beforeProcess(input, options)
		: input;
	const normalized = await normalizeInput(processedInput);
	const alphaApplyChunkRows =
		resolvedConfig.performance?.alphaApplyChunkRows ?? DEFAULT_ALPHA_APPLY_CHUNK_ROWS;
	const mobileMaxInferencePixels =
		resolvedConfig.performance?.mobileMaxInferencePixels ?? DEFAULT_MOBILE_MAX_INFERENCE_PIXELS;
	const desktopMaxInferencePixels =
		resolvedConfig.performance?.desktopMaxInferencePixels ?? DEFAULT_DESKTOP_MAX_INFERENCE_PIXELS;

	try {
		const { isMobile, isWeakDevice } = detectDeviceProfile();
		const inferenceSize = getInferenceSize(
			normalized.rawImage.width,
			normalized.rawImage.height,
			mobileMaxInferencePixels,
			desktopMaxInferencePixels,
			isMobile || isWeakDevice
		);

		const inferenceImage =
			inferenceSize.width === normalized.rawImage.width &&
			inferenceSize.height === normalized.rawImage.height
				? normalized.rawImage
				: await normalized.rawImage.resize(inferenceSize.width, inferenceSize.height);

		const { pixel_values } = await processor(inferenceImage);
		const modelResult = await model({ input: pixel_values });
		const output = (modelResult as { output: Array<{ squeeze: () => any }> }).output;
		const raw = output[0].squeeze();
		const minVal = raw.min().item() as number;
		const maxVal = raw.max().item() as number;
		const range = maxVal - minVal;
		const maskData =
			range < 1e-8
				? raw.mul_(0).add_(255).round_().to('uint8').unsqueeze(0)
				: raw.sub(minVal).div_(range).mul_(255).round_().to('uint8').unsqueeze(0);
		const maskImage = RawImage.fromTensor(maskData);
		const mask = await maskImage.resize(normalized.rawImage.width, normalized.rawImage.height);

		const canvas = createCanvas(normalized.rawImage.width, normalized.rawImage.height);
		canvas.width = normalized.rawImage.width;
		canvas.height = normalized.rawImage.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new InferenceError('Could not create output canvas context.');

		ctx.drawImage(normalized.drawableImage as CanvasImageSource, 0, 0);
		for (let y = 0; y < canvas.height; y += alphaApplyChunkRows) {
			const chunkHeight = Math.min(alphaApplyChunkRows, canvas.height - y);
			const pixelData = ctx.getImageData(0, y, canvas.width, chunkHeight);
			const chunkPixelCount = canvas.width * chunkHeight;
			const maskStart = y * canvas.width;

			for (let i = 0; i < chunkPixelCount; i++) {
				pixelData.data[i * 4 + 3] = mask.data[maskStart + i];
			}
			ctx.putImageData(pixelData, 0, y);
		}

		await yieldToMainThread();

		const finalCanvas =
			options?.background && options.background !== 'transparent'
				? renderWithBackgroundForRuntime(canvas, options.background)
				: canvas;
		const result = {
			canvas: toHtmlCanvas(finalCanvas),
			width: canvas.width,
			height: canvas.height
		};
		if (resolvedConfig.hooks?.afterProcess) {
			await resolvedConfig.hooks.afterProcess(result, { input: processedInput, options });
		}
		return result;
	} catch (error) {
		throw new InferenceError(
			error instanceof Error ? `Background removal failed: ${error.message}` : 'Background removal failed'
		);
	} finally {
		normalized.cleanup();
	}
}
