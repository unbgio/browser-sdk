import { CLIENT_PRESETS, DEFAULT_CLIENT_CONFIG } from './constants';
import type { ClientConfig } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge<T>(base: T, override?: Partial<T>): T {
	if (!override) return base;
	const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };

	for (const [key, overrideValue] of Object.entries(override as Record<string, unknown>)) {
		if (overrideValue === undefined) continue;
		const baseValue = merged[key];

		if (Array.isArray(overrideValue)) {
			merged[key] = overrideValue.slice();
			continue;
		}

		if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
			merged[key] = deepMerge(baseValue, overrideValue);
			continue;
		}

		merged[key] = overrideValue;
	}

	return merged as T;
}

function sortForStableStringify(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortForStableStringify);
	}
	if (!isPlainObject(value)) return value;

	const sortedKeys = Object.keys(value).sort();
	const sorted: Record<string, unknown> = {};
	for (const key of sortedKeys) {
		sorted[key] = sortForStableStringify(value[key]);
	}
	return sorted;
}

export function resolveClientConfig(config?: ClientConfig): ClientConfig {
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
	return resolved;
}

export function getClientConfigSignature(config?: ClientConfig): string {
	return JSON.stringify(sortForStableStringify(resolveClientConfig(config)));
}
