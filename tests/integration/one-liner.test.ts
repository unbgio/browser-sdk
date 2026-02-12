import { beforeEach, describe, expect, it, vi } from 'vitest';

const removeMock = vi.fn();
const removeManyMock = vi.fn();
const loadMock = vi.fn();
const getLoadedModelLabelMock = vi.fn();
const disposeMock = vi.fn();
const createClientMock = vi.fn(() => ({
	remove: removeMock,
	removeMany: removeManyMock,
	load: loadMock,
	getLoadedModelLabel: getLoadedModelLabelMock,
	dispose: disposeMock
}));

vi.mock('../../src/client', () => ({
	createClient: createClientMock
}));

describe('one-liner API', () => {
	beforeEach(() => {
		removeMock.mockReset();
		removeManyMock.mockReset();
		loadMock.mockReset();
		getLoadedModelLabelMock.mockReset();
		disposeMock.mockReset();
		createClientMock.mockClear();
	});

	it('reuses singleton client for same config', async () => {
		removeMock.mockResolvedValue({
			canvas: document.createElement('canvas'),
			width: 1,
			height: 1
		});
		const { removeBackground } = await import('../../src/removeBackground');

		await removeBackground('https://example.com/one.png');
		await removeBackground('https://example.com/two.png');

		expect(createClientMock).toHaveBeenCalledTimes(1);
		expect(removeMock).toHaveBeenCalledTimes(2);
	});

	it('exposes load/loadModel/getLoadedModelLabel/dispose helpers', async () => {
		loadMock.mockResolvedValue(undefined);
		getLoadedModelLabelMock.mockReturnValue('Loaded Candidate');

		const {
			load,
			loadModel,
			removeMany,
			getLoadedModelLabel,
			dispose,
			disposeDefaultClient
		} = await import('../../src/removeBackground');

		await loadModel();
		await load({ onProgress: vi.fn() });
		await removeMany(['https://example.com/one.png', 'https://example.com/two.png']);
		expect(loadMock).toHaveBeenCalledTimes(2);
		expect(removeManyMock).toHaveBeenCalledTimes(1);
		expect(getLoadedModelLabel()).toBe('Loaded Candidate');

		dispose();
		expect(disposeMock).toHaveBeenCalledTimes(1);
		disposeDefaultClient();
		expect(disposeMock).toHaveBeenCalledTimes(1);
	});
});
