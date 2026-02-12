import { canvasToBlobUrl, createClient, removeBackground, revokeBlobUrl } from '../src/index';

async function oneLinerExample(imageUrl: string): Promise<void> {
	const result = await removeBackground(imageUrl);
	const blobUrl = await canvasToBlobUrl(result.canvas, 'image/png');
	console.log('One-liner output:', blobUrl);
	revokeBlobUrl(blobUrl);
}

async function clientExample(imageUrl: string): Promise<void> {
	const client = createClient({
		preset: 'quality-desktop',
		performance: {
			alphaApplyChunkRows: 320
		}
	});
	await client.load();
	const [first, second] = await client.removeMany(
		[imageUrl, imageUrl],
		{ background: '#ffffff' },
		{ concurrency: 2 }
	);
	const blobUrl = await canvasToBlobUrl(first.canvas, 'image/png');
	const secondBlobUrl = await canvasToBlobUrl(second.canvas, 'image/png');
	console.log('Client output:', blobUrl, secondBlobUrl);
	revokeBlobUrl(blobUrl);
	revokeBlobUrl(secondBlobUrl);
	client.dispose();
}

await oneLinerExample('https://example.com/photo.jpg');
await clientExample('https://example.com/photo.jpg');
