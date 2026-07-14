import { beforeEach, describe, expect, it, vi } from 'vitest';

const removeMock = vi.fn();
const removeManyMock = vi.fn();
const loadMock = vi.fn();
const getLoadedModelLabelMock = vi.fn();
const disposeMock = vi.fn().mockResolvedValue(undefined);
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
		disposeMock.mockReset().mockResolvedValue(undefined);
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

		await dispose();
		expect(disposeMock).toHaveBeenCalledTimes(1);
		await disposeDefaultClient();
		expect(disposeMock).toHaveBeenCalledTimes(1);
	});

	it('starts disposal when replacing the singleton with a different config', async () => {
		removeMock.mockResolvedValue({
			canvas: document.createElement('canvas'),
			width: 1,
			height: 1
		});
		const { disposeDefaultClient, removeBackground } = await import('../../src/removeBackground');

		await removeBackground(new Blob(['a']), undefined, { model: { revision: 'one' } });
		await removeBackground(new Blob(['b']), undefined, { model: { revision: 'two' } });

		expect(createClientMock).toHaveBeenCalledTimes(2);
		expect(disposeMock).toHaveBeenCalledTimes(1);
		await disposeDefaultClient();
		expect(disposeMock).toHaveBeenCalledTimes(2);
	});

	it('waits for clients already being disposed when clearing the singleton', async () => {
		removeMock.mockResolvedValue({
			canvas: document.createElement('canvas'),
			width: 1,
			height: 1
		});
		let finishPreviousDisposal!: () => void;
		disposeMock
			.mockReturnValueOnce(new Promise<void>((resolve) => (finishPreviousDisposal = resolve)))
			.mockResolvedValueOnce(undefined);
		const { disposeDefaultClient, removeBackground } = await import('../../src/removeBackground');

		await removeBackground(new Blob(['a']), undefined, { model: { revision: 'first' } });
		await removeBackground(new Blob(['b']), undefined, { model: { revision: 'second' } });
		const disposing = disposeDefaultClient();
		let completed = false;
		void disposing.then(() => (completed = true));
		await Promise.resolve();
		expect(completed).toBe(false);

		finishPreviousDisposal();
		await disposing;
		expect(disposeMock).toHaveBeenCalledTimes(2);
	});
});
