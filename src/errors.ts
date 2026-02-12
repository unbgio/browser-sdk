export class ModelLoadError extends Error {
	override name = 'ModelLoadError';
}

export class UnsupportedInputError extends Error {
	override name = 'UnsupportedInputError';
}

export class InferenceError extends Error {
	override name = 'InferenceError';
}
