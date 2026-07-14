import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, resolve, sep } from 'node:path';

import { expect, test } from '@playwright/test';

let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
	const distRoot = resolve(process.cwd(), 'dist');
	const transformersDist = resolve(process.cwd(), 'node_modules/@huggingface/transformers/dist');
	server = createServer((request, response) => {
		void (async () => {
			try {
				const pathname = decodeURIComponent(
					new URL(request.url ?? '/', 'http://localhost').pathname
				);
				if (pathname === '/') {
					response.setHeader('content-type', 'text/html; charset=utf-8');
					response.end('<!doctype html><html><body><main>SDK smoke test</main></body></html>');
					return;
				}
				if (pathname === '/index.js') {
					const bundle = await readFile(resolve(distRoot, 'index.js'), 'utf8');
					response.setHeader('content-type', 'text/javascript; charset=utf-8');
					response.end(
						bundle.replace(
							/["']@huggingface\/transformers["']/g,
							'"/vendor/transformers.min.js"'
						)
					);
					return;
				}
				if (pathname.startsWith('/vendor/')) {
					const vendorPath = resolve(transformersDist, pathname.replace('/vendor/', ''));
					if (!vendorPath.startsWith(`${transformersDist}${sep}`)) {
						response.statusCode = 403;
						response.end('Forbidden');
						return;
					}
					response.setHeader('content-type', 'text/javascript; charset=utf-8');
					response.end(await readFile(vendorPath));
					return;
				}
				const filePath = resolve(distRoot, pathname.replace(/^\/+/, ''));
				if (!filePath.startsWith(`${distRoot}${sep}`)) {
					response.statusCode = 403;
					response.end('Forbidden');
					return;
				}
				const contentTypes: Record<string, string> = {
					'.js': 'text/javascript; charset=utf-8',
					'.json': 'application/json',
					'.map': 'application/json',
					'.wasm': 'application/wasm'
				};
				response.setHeader('content-type', contentTypes[extname(filePath)] ?? 'application/octet-stream');
				response.end(await readFile(filePath));
			} catch {
				response.statusCode = 404;
				response.end('Not found');
			}
		})();
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolveListen);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Failed to start browser test server.');
	baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	await new Promise<void>((resolveClose, reject) => {
		server.close((error) => (error ? reject(error) : resolveClose()));
	});
});

test('loads the published bundle and completes a real worker RPC lifecycle', async ({ page }) => {
	await page.goto(baseUrl);
	const result = await page.evaluate(async (moduleUrl) => {
		const sdk = await import(moduleUrl);
		const canvas = document.createElement('canvas');
		canvas.width = 10;
		canvas.height = 10;
		const ctx = canvas.getContext('2d');
		if (!ctx) return { ok: false, reason: '2d context unavailable' };
		ctx.fillStyle = '#ff0000';
		ctx.fillRect(0, 0, 10, 10);
		const blobUrl = await sdk.canvasToBlobUrl(canvas, 'image/png');
		sdk.revokeBlobUrl(blobUrl);

		const workerSource = `import { attachWorkerRuntime } from ${JSON.stringify(moduleUrl)}; attachWorkerRuntime(self);`;
		const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
		try {
			const client = sdk.createWorkerClient({
				mode: 'worker',
				requestTimeoutMs: 5_000,
				config: { performance: { maxBatchSize: 2 } },
				workerFactory: () => new Worker(workerUrl, { type: 'module' })
			});
			await client.dispose();
		} finally {
			URL.revokeObjectURL(workerUrl);
		}

		return {
			ok: true,
			webgpu: 'gpu' in navigator,
			dataUrlPrefix: canvas.toDataURL('image/png').slice(0, 22),
			exportsReady:
				typeof sdk.createClient === 'function' &&
				typeof sdk.createWorkerClient === 'function' &&
				typeof sdk.attachWorkerRuntime === 'function'
		};
	}, `${baseUrl}/index.js`);

	expect(result.ok).toBe(true);
	expect(result.exportsReady).toBe(true);
	expect(result.dataUrlPrefix).toBe('data:image/png;base64,');
});
