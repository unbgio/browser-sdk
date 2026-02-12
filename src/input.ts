import { RawImage } from '@huggingface/transformers';

import { UnsupportedInputError } from './errors';
import type { RemoveBackgroundInput } from './types';

interface NormalizedInput {
	rawImage: RawImage;
	drawableImage: CanvasImageSource;
	cleanup: () => void;
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

async function loadImageElement(url: string): Promise<HTMLImageElement> {
	const image = new Image();
	image.crossOrigin = 'anonymous';

	await new Promise<void>((resolve, reject) => {
		image.onload = () => resolve();
		image.onerror = () => reject(new UnsupportedInputError('Failed to load image input.'));
		image.src = url;
	});

	return image;
}

async function loadDrawableFromUrl(url: string): Promise<CanvasImageSource> {
	if (typeof Image !== 'undefined') {
		return await loadImageElement(url);
	}
	if (typeof fetch !== 'undefined' && typeof createImageBitmap !== 'undefined') {
		const response = await fetch(url);
		if (!response.ok) throw new UnsupportedInputError('Failed to fetch image input.');
		const blob = await response.blob();
		return await createImageBitmap(blob);
	}
	throw new UnsupportedInputError('No drawable image API available for URL input.');
}

async function blobToDrawable(blob: Blob): Promise<CanvasImageSource> {
	if (typeof createImageBitmap !== 'undefined') {
		return await createImageBitmap(blob);
	}
	const objectUrl = await blobToObjectUrl(blob);
	try {
		return await loadDrawableFromUrl(objectUrl);
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

export async function normalizeInput(input: RemoveBackgroundInput): Promise<NormalizedInput> {
	if (typeof input === 'string') {
		const [rawImage, drawableImage] = await Promise.all([
			RawImage.fromURL(input),
			loadDrawableFromUrl(input)
		]);
		return {
			rawImage,
			drawableImage,
			cleanup: () => undefined
		};
	}

	if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) {
		const source = input.currentSrc || input.src;
		if (!source) throw new UnsupportedInputError('HTMLImageElement has no source URL.');
		const [rawImage, drawableImage] = await Promise.all([
			RawImage.fromURL(source),
			loadDrawableFromUrl(source)
		]);
		return {
			rawImage,
			drawableImage,
			cleanup: () => undefined
		};
	}

	let objectUrl = '';
	let blob: Blob;

	if (input instanceof Blob) {
		blob = input;
	} else if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) {
		blob = await canvasToBlob(input);
	} else if (typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap) {
		blob = await imageBitmapToBlob(input);
	} else {
		throw new UnsupportedInputError('Unsupported input. Use URL, Blob, File, image, canvas, or ImageBitmap.');
	}

	objectUrl = await blobToObjectUrl(blob);
	const [rawImage, drawableImage] = await Promise.all([RawImage.fromURL(objectUrl), blobToDrawable(blob)]);

	return {
		rawImage,
		drawableImage,
		cleanup: () => {
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		}
	};
}
