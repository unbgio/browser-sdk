# Changelog

All notable changes to this project will be documented in this file.

## [2.0.1] - 2026-07-14

- Updated `@huggingface/transformers` to 4.2.0 and refreshed its transitive runtime dependencies.
- Updated the supported development stack to TypeScript 6.0.3, Node.js 24 types, Node.js 24.18.0 LTS, and npm 12.0.1.
- Updated the protobufjs and Rollup resolution overrides, retained the latest esbuild override, and removed obsolete overrides.
- Updated CI and release workflows to Node.js 24 and the latest immutable action revisions.

## [2.0.0] - 2026-07-14

- Made client disposal asynchronous and deterministic, including in-flight model loads, inference, worker failures, and one-liner singleton replacement.
- Added encoded-byte, decoded-pixel, and batch-size resource limits with typed `ResourceLimitError` failures.
- Added validated worker RPC messages, bounded request/shutdown timeouts, transferable cleanup, and a real browser worker lifecycle test.
- Serialized model downloads so Transformers' global runtime settings cannot leak between concurrent clients.
- Hardened configuration merging against malformed values and prototype-mutating keys.
- Updated vulnerable dependency chains and pinned CI actions to immutable revisions.

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

