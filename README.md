# @unbg/browser-sdk

Browser-first background removal SDK with two ergonomic APIs:

- **One-liner** for fast onboarding: `removeBackground(input, options?)`
- **Client API** for repeated workloads: `createClient(config?)`

## Install

```bash
npm install @unbg/browser-sdk
```

## 30-Second Quick Start

```ts
import { removeBackground, canvasToBlobUrl, revokeBlobUrl } from '@unbg/browser-sdk';

const result = await removeBackground('https://example.com/photo.jpg');
const blobUrl = await canvasToBlobUrl(result.canvas, 'image/png');

// Use blob URL in download links or img tags.
// Revoke when finished to avoid leaking memory.
revokeBlobUrl(blobUrl);
```

## Advanced Client API

```ts
import { createClient } from '@unbg/browser-sdk';

const client = createClient({
	preset: 'quality-desktop'
});

await client.load({
	onProgress(progress) {
		console.log(progress.progress);
	}
});

const result = await client.remove('https://example.com/photo.jpg', {
	background: '#ffffff'
});

await client.dispose();
```

### Progressive Config Model

- `createClient()` uses default settings.
- `createClient({ preset: 'fast-mobile' | 'quality-desktop' })` applies tuned defaults.
- Any explicit `model`, `runtime`, or `performance` values override preset/default values via deep merge.

```ts
const client = createClient({
	preset: 'fast-mobile',
	performance: {
		alphaApplyChunkRows: 192 // deep override
	}
});
```

## API

### `removeBackground(input, options?, config?)`

Use this for the easiest path. Internally reuses a singleton client for performance.

Companion one-liner helpers:

- `load(options?, config?)` (alias of `loadModel`)
- `loadModel(options?, config?)` (supports old `loadModel(onProgress, config)` shape)
- `removeMany(inputs, options?, config?, batchOptions?)`
- `dispose()` (alias of `disposeDefaultClient`)

### `createClient(config?)`

Creates a dedicated client instance with explicit lifecycle (`load`, `remove`, `removeMany`, `dispose`).

### Inputs

- `string` (URL)
- `Blob` / `File`
- `HTMLImageElement`
- `ImageBitmap`
- `HTMLCanvasElement`

### `ClientConfig`

- `preset`: `fast-mobile` | `quality-desktop`
- `model.modelId`: defaults to `briaai/RMBG-1.4`
- `model.revision`: defaults to `main`
- `model.strategy`: `auto` | `webgpu-fp16` | `wasm-q8`
- `model.candidates`: explicit candidate override list
- `runtime`: transformers.js runtime knobs (cache, local/remote model behavior)
  - default remote source is Hugging Face public host (`https://huggingface.co`)
  - default path template is `/{model}/resolve/{revision}/`
- `performance`: resize thresholds, alpha-apply chunk size, and resource limits
  - `maxInputBytes`: maximum encoded input size (default: 50 MiB)
  - `maxInputPixels`: maximum decoded image area (default: 40 million pixels)
  - `maxBatchSize`: maximum inputs accepted by one batch (default: 100)
- `hooks`:
  - `beforeProcess(input, options?)`
  - `afterProcess(result, context)`
  - `telemetry(event)`

Override runtime if you want self-hosted/proxied model assets:

```ts
const client = createClient({
	runtime: {
		remoteHost: 'https://my-cdn.example.com',
		remotePathTemplate: '/models/{model}/resolve/{revision}/'
	}
});
```

### `RemoveOptions`

- `background`: `'transparent'` or CSS color string
- `signal`: cancels preprocessing or a pending worker request
- To encode the returned canvas, pass type/quality to `canvasToBlob()` or `canvasToBlobUrl()`.

### Worker / Off-main-thread Mode

Create a dedicated module-worker entry:

```ts
// background-removal.worker.ts
import { attachWorkerRuntime } from '@unbg/browser-sdk';

attachWorkerRuntime(self);
```

Then construct the worker from application code:

```ts
import { createWorkerClient } from '@unbg/browser-sdk';

const client = createWorkerClient({
	mode: 'auto',
	workerFactory: () =>
		new Worker(new URL('./background-removal.worker.ts', import.meta.url), {
			type: 'module'
		})
});

try {
	const result = await client.remove(file);
	// Use result.canvas.
} finally {
	await client.dispose();
}
```

`createWorkerClient({ mode, workerFactory, config })` supports three explicit modes:

- `auto` uses the worker when `Worker`, `OffscreenCanvas`, and `workerFactory` are available; otherwise it falls back to the main thread.
- `worker` requires all worker prerequisites and throws when they are unavailable.
- `main-thread` always uses a regular client.

Worker configuration excludes function hooks because functions cannot be structured-cloned. Use
`createClient()` when `beforeProcess`, `afterProcess`, or `telemetry` hooks are required. Passing an
`ImageBitmap` to a worker-backed removal transfers ownership to the worker; do not reuse that bitmap.

## Browser Compatibility & Performance

- Prefers WebGPU fp16 where available.
- Falls back to WASM q8 for broader compatibility.
- Automatically scales very large images down for inference, then upscales mask to source dimensions.
- Processes alpha channel in chunks to reduce memory pressure on weaker devices.

## Model Licensing

This SDK is licensed under MIT, but its default model (`briaai/RMBG-1.4`) is
licensed separately under `bria-rmbg-1.4`.

- Model page: <https://huggingface.co/briaai/RMBG-1.4>
- See `THIRD_PARTY_NOTICES.md` for attribution and licensing context.

The default model is offered for non-commercial use under BRIA's model terms.
Commercial use requires a separate agreement with BRIA. Choosing another model
does not transfer this SDK's MIT license to that model.

## Error Handling

Public error classes:

- `ModelLoadError`
- `UnsupportedInputError`
- `InferenceError`
- `ClientDisposedError`
- `ResourceLimitError`

## Troubleshooting

- **Model loading fails**: verify network access to model assets and CORS policy.
- **Slow on mobile**: lower `mobileMaxInferencePixels` in `performance`.
- **Memory pressure**:
  - Call `dispose()` when a long-lived client is idle, app teardown begins, or you switch to a new config/preset.
  - Call `revokeBlobUrl()` for URLs produced by `canvasToBlobUrl()` after your image/download consumer is done.
  - Input object URLs created internally by the SDK are cleaned up automatically.

## Testing

Development and release verification use Node.js 24.18.0 LTS and npm 12.0.1.

```bash
npm run test
npm run test:browser
npm run verify:release
```

## Semver Policy

- Backward-compatible additions ship as **minor** releases.
- Breaking API changes ship as **major** releases.
- Deprecated APIs are announced in release notes before removal.
