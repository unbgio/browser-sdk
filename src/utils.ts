export function isWebGPUAvailable(): boolean {
	return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function canvasToBlob(
	canvas: HTMLCanvasElement,
	type = 'image/png',
	quality = 1
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (!blob) {
					reject(new Error('Failed to create blob from canvas'));
					return;
				}
				resolve(blob);
			},
			type,
			quality
		);
	});
}

export function canvasToBlobUrl(
	canvas: HTMLCanvasElement,
	type = 'image/png',
	quality = 1
): Promise<string> {
	return canvasToBlob(canvas, type, quality).then((blob) => URL.createObjectURL(blob));
}

export function renderWithBackground(sourceCanvas: HTMLCanvasElement, bgColor: string): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = sourceCanvas.width;
	canvas.height = sourceCanvas.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not create rendering context.');

	ctx.fillStyle = bgColor;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(sourceCanvas, 0, 0);
	return canvas;
}

export function revokeBlobUrl(url: string): void {
	URL.revokeObjectURL(url);
}
