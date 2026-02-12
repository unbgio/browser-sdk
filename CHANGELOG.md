# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-02-12

- Progressive config model with top-level presets: `fast-mobile`, `quality-desktop`.
- Deterministic deep config merge and stable singleton signature behavior.
- Batch API: `client.removeMany(...)` and one-liner `removeMany(...)`.
- Worker-mode entrypoints: `createWorkerClient(...)` and `attachWorkerRuntime(...)`.
- Pipeline hooks in `ClientConfig.hooks`: `beforeProcess`, `afterProcess`, `telemetry`.
- Additional root type exports including `RemoveBackgroundClient` and worker protocol types.
- Browser-first SDK architecture with one-liner and client APIs.
- Configurable model strategy and runtime/performance controls.
- Unit and integration test suite plus browser smoke tests.
- Release-ready npm packaging, CI, and documentation.
- One-liner API now has `load(...)` and `dispose()` aliases for consistency with client verbs.
- `loadModel(...)` accepts `LoadOptions` while preserving the older callback signature.
- `canvasToBlob(...)` now returns `Blob` (URL output remains `canvasToBlobUrl(...)`).
- Expanded memory lifecycle guidance for `dispose()` and `revokeBlobUrl()`.
- Added preset/deep-override examples and worker fallback behavior notes.

