export class ModelLoadError extends Error {
	override name = 'ModelLoadError';
}

export class UnsupportedInputError extends Error {
	override name = 'UnsupportedInputError';
}

export class InferenceError extends Error {
	override name = 'InferenceError';
}

export class ClientDisposedError extends Error {
	override name = 'ClientDisposedError';
}

export class ResourceLimitError extends Error {
	override name = 'ResourceLimitError';
}
