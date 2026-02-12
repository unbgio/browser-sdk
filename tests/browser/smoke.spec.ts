import { expect, test } from '@playwright/test';

test('browser runtime smoke check', async ({ page }) => {
	await page.goto('about:blank');
	const result = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 10;
		canvas.height = 10;
		const ctx = canvas.getContext('2d');
		if (!ctx) return { ok: false, reason: '2d context unavailable' };
		ctx.fillStyle = '#ff0000';
		ctx.fillRect(0, 0, 10, 10);
		return {
			ok: true,
			webgpu: 'gpu' in navigator,
			dataUrlPrefix: canvas.toDataURL('image/png').slice(0, 22)
		};
	});

	expect(result.ok).toBe(true);
	expect(result.dataUrlPrefix).toBe('data:image/png;base64,');
});
