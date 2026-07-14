import { CLIENT_PRESETS, DEFAULT_CLIENT_CONFIG } from './constants';
import type { ClientConfig, ModelCandidateConfig, PipelineHooks } from './types';

const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CLIENT_PRESETS_SET = new Set(['fast-mobile', 'quality-desktop']);
const MODEL_STRATEGIES = new Set(['auto', 'webgpu-fp16', 'wasm-q8']);
const RUNTIME_DEVICES = new Set(['webgpu', 'wasm']);
const MODEL_DTYPES = new Set(['fp16', 'fp32', 'q8']);
const CLIENT_CONFIG_KEYS = new Set(['preset', 'model', 'runtime', 'performance', 'hooks']);
const MODEL_CONFIG_KEYS = new Set(['modelId', 'revision', 'strategy', 'candidates']);
const CANDIDATE_CONFIG_KEYS = new Set(['modelId', 'device', 'dtype', 'label']);
const RUNTIME_CONFIG_KEYS = new Set([
	'useBrowserCache',
	'allowLocalModels',
	'allowRemoteModels',
	'localModelPath',
	'remoteHost',
	'remotePathTemplate'
]);
const PERFORMANCE_CONFIG_KEYS = new Set([
	'mobileMaxInferencePixels',
	'desktopMaxInferencePixels',
	'alphaApplyChunkRows',
	'maxInputBytes',
	'maxInputPixels',
	'maxBatchSize'
]);
const HOOK_CONFIG_KEYS = new Set(['beforeProcess', 'afterProcess', 'telemetry']);
const functionIds = new WeakMap<Function, number>();
let nextFunctionId = 0;

function isPlainObject(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function deepMerge<T>(base: T, override?: Partial<T>): T {
	if (!override) return base;
	const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };

	for (const [key, overrideValue] of Object.entries(override as Record<string, unknown>)) {
		if (BLOCKED_OBJECT_KEYS.has(key)) {
			throw new TypeError(`Configuration key "${key}" is not allowed.`);
		}
		if (overrideValue === undefined) continue;
		const baseValue = merged[key];

		if (Array.isArray(overrideValue)) {
			merged[key] = overrideValue.slice();
			continue;
		}

		if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
			merged[key] = deepMerge(
				baseValue as Record<string, unknown>,
				overrideValue as Record<string, unknown>
			);
			continue;
		}

		merged[key] = overrideValue;
	}

	return merged as T;
}

function sortForStableStringify(value: unknown): unknown {
	if (typeof value === 'function') {
		let id = functionIds.get(value);
		if (id === undefined) {
			nextFunctionId += 1;
			id = nextFunctionId;
			functionIds.set(value, id);
		}
		return `[Function:${id}]`;
	}
	if (Array.isArray(value)) {
		return value.map(sortForStableStringify);
	}
	if (!isPlainObject(value)) return value;

	const record = value as Record<string, unknown>;
	const sortedKeys = Object.keys(record).sort();
	const sorted: Record<string, unknown> = {};
	for (const key of sortedKeys) {
		sorted[key] = sortForStableStringify(record[key]);
	}
	return sorted;
}

function assertPositiveInteger(value: number | undefined, name: string): void {
	if (value === undefined) return;
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`${name} must be a positive safe integer.`);
	}
}

function assertOptionalBoolean(value: boolean | undefined, name: string): void {
	if (value !== undefined && typeof value !== 'boolean') {
		throw new TypeError(`${name} must be a boolean.`);
	}
}

function assertOptionalString(value: string | undefined, name: string): void {
	if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0)) {
		throw new TypeError(`${name} must be a non-empty string.`);
	}
}

function assertString(value: unknown, name: string): asserts value is string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new TypeError(`${name} must be a non-empty string.`);
	}
}

function assertOptionalFunction(value: unknown, name: string): void {
	if (value !== undefined && typeof value !== 'function') {
		throw new TypeError(`${name} must be a function.`);
	}
}

function assertOnlyKeys(value: object, name: string, allowedKeys: ReadonlySet<string>): void {
	for (const key of Object.keys(value)) {
		if (!allowedKeys.has(key)) throw new TypeError(`${name} contains unknown key "${key}".`);
	}
}

function validateCandidate(candidate: ModelCandidateConfig, index: number): void {
	if (!isPlainObject(candidate)) {
		throw new TypeError(`model.candidates[${index}] must be an object.`);
	}
	assertOnlyKeys(candidate, `model.candidates[${index}]`, CANDIDATE_CONFIG_KEYS);
	assertString(candidate.modelId, `model.candidates[${index}].modelId`);
	assertString(candidate.label, `model.candidates[${index}].label`);
	if (!RUNTIME_DEVICES.has(candidate.device)) {
		throw new TypeError(`model.candidates[${index}].device is invalid.`);
	}
	if (!MODEL_DTYPES.has(candidate.dtype)) {
		throw new TypeError(`model.candidates[${index}].dtype is invalid.`);
	}
}

function validateHooks(hooks: PipelineHooks | undefined): void {
	if (hooks === undefined) return;
	if (!isPlainObject(hooks)) throw new TypeError('hooks must be an object.');
	assertOnlyKeys(hooks, 'hooks', HOOK_CONFIG_KEYS);
	assertOptionalFunction(hooks.beforeProcess, 'hooks.beforeProcess');
	assertOptionalFunction(hooks.afterProcess, 'hooks.afterProcess');
	assertOptionalFunction(hooks.telemetry, 'hooks.telemetry');
}

function validateConfig(config: ClientConfig): void {
	assertOnlyKeys(config, 'Client configuration', CLIENT_CONFIG_KEYS);
	if (config.preset !== undefined && !CLIENT_PRESETS_SET.has(config.preset)) {
		throw new TypeError('preset must be "fast-mobile" or "quality-desktop".');
	}
	if (config.model !== undefined && !isPlainObject(config.model)) {
		throw new TypeError('model must be an object.');
	}
	if (config.runtime !== undefined && !isPlainObject(config.runtime)) {
		throw new TypeError('runtime must be an object.');
	}
	if (config.performance !== undefined && !isPlainObject(config.performance)) {
		throw new TypeError('performance must be an object.');
	}
	if (config.model) assertOnlyKeys(config.model, 'model', MODEL_CONFIG_KEYS);
	if (config.runtime) assertOnlyKeys(config.runtime, 'runtime', RUNTIME_CONFIG_KEYS);
	if (config.performance) {
		assertOnlyKeys(config.performance, 'performance', PERFORMANCE_CONFIG_KEYS);
	}

	assertOptionalString(config.model?.modelId, 'model.modelId');
	assertOptionalString(config.model?.revision, 'model.revision');
	if (config.model?.strategy !== undefined && !MODEL_STRATEGIES.has(config.model.strategy)) {
		throw new TypeError('model.strategy is invalid.');
	}
	if (config.model?.candidates !== undefined) {
		if (!Array.isArray(config.model.candidates) || config.model.candidates.length === 0) {
			throw new TypeError('model.candidates must be a non-empty array when provided.');
		}
		config.model.candidates.forEach(validateCandidate);
	}

	assertOptionalBoolean(config.runtime?.useBrowserCache, 'runtime.useBrowserCache');
	assertOptionalBoolean(config.runtime?.allowLocalModels, 'runtime.allowLocalModels');
	assertOptionalBoolean(config.runtime?.allowRemoteModels, 'runtime.allowRemoteModels');
	assertOptionalString(config.runtime?.localModelPath, 'runtime.localModelPath');
	assertOptionalString(config.runtime?.remoteHost, 'runtime.remoteHost');
	assertOptionalString(config.runtime?.remotePathTemplate, 'runtime.remotePathTemplate');
	if (config.runtime?.remoteHost !== undefined) {
		let remoteHost: URL;
		try {
			remoteHost = new URL(config.runtime.remoteHost);
		} catch {
			throw new TypeError('runtime.remoteHost must be an absolute HTTP(S) URL.');
		}
		if (!['http:', 'https:'].includes(remoteHost.protocol) || remoteHost.username || remoteHost.password) {
			throw new TypeError('runtime.remoteHost must be an absolute HTTP(S) URL without credentials.');
		}
	}

	assertPositiveInteger(config.performance?.mobileMaxInferencePixels, 'performance.mobileMaxInferencePixels');
	assertPositiveInteger(config.performance?.desktopMaxInferencePixels, 'performance.desktopMaxInferencePixels');
	assertPositiveInteger(config.performance?.alphaApplyChunkRows, 'performance.alphaApplyChunkRows');
	assertPositiveInteger(config.performance?.maxInputBytes, 'performance.maxInputBytes');
	assertPositiveInteger(config.performance?.maxInputPixels, 'performance.maxInputPixels');
	assertPositiveInteger(config.performance?.maxBatchSize, 'performance.maxBatchSize');
	validateHooks(config.hooks);
}

export function resolveClientConfig(config?: ClientConfig): ClientConfig {
	if (config !== undefined && !isPlainObject(config)) {
		throw new TypeError('Client configuration must be an object.');
	}
	validateConfig(config ?? {});
	const withoutPreset: ClientConfig = { ...(config ?? {}) };
	delete withoutPreset.preset;

	const withDefault: ClientConfig = deepMerge(DEFAULT_CLIENT_CONFIG, undefined);
	const withPreset = config?.preset ? deepMerge(withDefault, CLIENT_PRESETS[config.preset]) : withDefault;
	const resolved = deepMerge(withPreset, withoutPreset);

	if (config?.preset) {
		resolved.preset = config.preset;
	}
	if (config?.hooks) {
		resolved.hooks = config.hooks;
	}
	validateConfig(resolved);
	return resolved;
}

export function getClientConfigSignature(config?: ClientConfig): string {
	return JSON.stringify(sortForStableStringify(resolveClientConfig(config)));
}
