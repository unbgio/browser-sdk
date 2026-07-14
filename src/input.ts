import { RawImage } from '@huggingface/transformers';

import { ResourceLimitError, UnsupportedInputError } from './errors';
import type { RemoveBackgroundInput } from './types';

interface NormalizedInput {
	rawImage: RawImage;
	drawableImage: CanvasImageSource;
	cleanup: () => void;
}

interface NormalizeInputOptions {
	maxInputBytes: number;
	maxInputPixels: number;
	signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
	throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function validateDimensions(width: number, height: number, maxInputPixels: number): void {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
		throw new UnsupportedInputError('Image dimensions must be positive safe integers.');
	}
	const pixels = width * height;
	if (!Number.isSafeInteger(pixels) || pixels > maxInputPixels) {
		throw new ResourceLimitError(
			`Image contains ${pixels.toLocaleString()} pixels; the configured limit is ${maxInputPixels.toLocaleString()}.`
		);
	}
}

function validateBlobSize(blob: Blob, maxInputBytes: number): void {
	if (blob.size > maxInputBytes) {
		throw new ResourceLimitError(
			`Image is ${blob.size.toLocaleString()} bytes; the configured limit is ${maxInputBytes.toLocaleString()} bytes.`
		);
	}
}

async function fetchBlobWithinLimit(
	url: string,
	maxInputBytes: number,
	signal?: AbortSignal
): Promise<Blob> {
	if (typeof fetch === 'undefined') {
		throw new UnsupportedInputError('URL input requires the Fetch API.');
	}
	const response = await fetch(url, { signal });
	if (!response.ok) {
		throw new UnsupportedInputError(`Failed to fetch image input (HTTP ${response.status}).`);
	}
	const contentLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(contentLength) && contentLength > maxInputBytes) {
		void response.body?.cancel().catch(() => undefined);
		throw new ResourceLimitError(
			`Image is ${contentLength.toLocaleString()} bytes; the configured limit is ${maxInputBytes.toLocaleString()} bytes.`
		);
	}
	if (!response.body) {
		const blob = await response.blob();
		validateBlobSize(blob, maxInputBytes);
		return blob;
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	try {
		while (true) {
			throwIfAborted(signal);
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > maxInputBytes) {
				await reader.cancel();
				throw new ResourceLimitError(
					`Image exceeds the configured limit of ${maxInputBytes.toLocaleString()} bytes.`
				);
			}
			chunks.push(value);
		}
	} catch (error) {
		void reader.cancel().catch(() => undefined);
		throw error;
	}
	return new Blob(chunks as BlobPart[], {
		type: response.headers.get('content-type') ?? undefined
	});
}

function closeDrawable(drawable: CanvasImageSource): void {
	if (typeof ImageBitmap !== 'undefined' && drawable instanceof ImageBitmap) drawable.close();
}

async function blobToObjectUrl(blob: Blob): Promise<string> {
	return URL.createObjectURL(blob);
}

async function imageBitmapToBlob(imageBitmap: ImageBitmap): Promise<Blob> {
	if (typeof OffscreenCanvas === 'undefined') {
		const canvas = document.createElement('canvas');
		canvas.width = imageBitmap.width;
		canvas.height = imageBitmap.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new UnsupportedInputError('Could not create canvas context for ImageBitmap.');
		ctx.drawImage(imageBitmap, 0, 0);
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((blob) => {
				if (!blob) reject(new UnsupportedInputError('Failed to convert ImageBitmap into Blob.'));
				else resolve(blob);
			});
		});
	}

	const offscreen = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
	const ctx = offscreen.getContext('2d');
	if (!ctx) throw new UnsupportedInputError('Could not create offscreen context for ImageBitmap.');
	ctx.drawImage(imageBitmap, 0, 0);
	return await offscreen.convertToBlob();
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (!blob) reject(new UnsupportedInputError('Failed to convert canvas into Blob.'));
			else resolve(blob);
		});
	});
}

async function loadImageElement(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
	const image = new Image();
	image.crossOrigin = 'anonymous';

	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener('abort', onAbort);
			image.onload = null;
			image.onerror = null;
			callback();
		};
		const onAbort = (): void => {
			finish(() => {
				image.src = '';
				reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
			});
		};
		image.onload = () => finish(resolve);
		image.onerror = () => finish(() => reject(new UnsupportedInputError('Failed to load image input.')));
		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener('abort', onAbort, { once: true });
		image.src = url;
	});

	return image;
}

async function loadDrawableFromUrl(url: string, signal?: AbortSignal): Promise<CanvasImageSource> {
	if (typeof Image !== 'undefined') {
		return await loadImageElement(url, signal);
	}
	if (typeof fetch !== 'undefined' && typeof createImageBitmap !== 'undefined') {
		const response = await fetch(url, { signal });
		if (!response.ok) throw new UnsupportedInputError('Failed to fetch image input.');
		const blob = await response.blob();
		return await createImageBitmap(blob);
	}
	throw new UnsupportedInputError('No drawable image API available for URL input.');
}

async function blobToDrawable(blob: Blob): Promise<CanvasImageSource> {
	if (typeof createImageBitmap !== 'undefined') {
		try {
			return await createImageBitmap(blob);
		} catch {
			// Some embedded browsers expose createImageBitmap without supporting Blob inputs.
		}
	}
	const objectUrl = await blobToObjectUrl(blob);
	try {
		return await loadDrawableFromUrl(objectUrl);
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

export async function normalizeInput(
	input: RemoveBackgroundInput,
	options: NormalizeInputOptions = {
		maxInputBytes: Number.MAX_SAFE_INTEGER,
		maxInputPixels: Number.MAX_SAFE_INTEGER
	}
): Promise<NormalizedInput> {
	throwIfAborted(options.signal);
	if (typeof input === 'string') {
		const blob = await fetchBlobWithinLimit(input, options.maxInputBytes, options.signal);
		return await normalizeInput(blob, options);
	}

	if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) {
		const source = input.currentSrc || input.src;
		if (!source) throw new UnsupportedInputError('HTMLImageElement has no source URL.');
		validateDimensions(input.naturalWidth || input.width, input.naturalHeight || input.height, options.maxInputPixels);
		const rawImage = await RawImage.fromURL(source);
		throwIfAborted(options.signal);
		validateDimensions(rawImage.width, rawImage.height, options.maxInputPixels);
		return {
			rawImage,
			drawableImage: input,
			cleanup: () => undefined
		};
	}

	let objectUrl = '';
	let blob: Blob;

	if (input instanceof Blob) {
		blob = input;
	} else if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) {
		validateDimensions(input.width, input.height, options.maxInputPixels);
		blob = await canvasToBlob(input);
	} else if (typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap) {
		validateDimensions(input.width, input.height, options.maxInputPixels);
		blob = await imageBitmapToBlob(input);
	} else {
		throw new UnsupportedInputError('Unsupported input. Use URL, Blob, File, image, canvas, or ImageBitmap.');
	}
	validateBlobSize(blob, options.maxInputBytes);
	throwIfAborted(options.signal);

	objectUrl = await blobToObjectUrl(blob);
	const [rawResult, drawableResult] = await Promise.allSettled([
		RawImage.fromURL(objectUrl),
		blobToDrawable(blob)
	]);
	if (rawResult.status === 'rejected' || drawableResult.status === 'rejected') {
		URL.revokeObjectURL(objectUrl);
		if (drawableResult.status === 'fulfilled') closeDrawable(drawableResult.value);
		if (rawResult.status === 'rejected') throw rawResult.reason;
		throw drawableResult.status === 'rejected'
			? drawableResult.reason
			: new UnsupportedInputError('Failed to decode image input.');
	}
	const rawImage = rawResult.value;
	const drawableImage = drawableResult.value;
	try {
		throwIfAborted(options.signal);
		validateDimensions(rawImage.width, rawImage.height, options.maxInputPixels);
	} catch (error) {
		URL.revokeObjectURL(objectUrl);
		closeDrawable(drawableImage);
		throw error;
	}
	let cleaned = false;

	return {
		rawImage,
		drawableImage,
		cleanup: () => {
			if (cleaned) return;
			cleaned = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			closeDrawable(drawableImage);
		}
	};
}
