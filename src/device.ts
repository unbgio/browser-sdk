export interface DeviceProfile {
	hasWebGPU: boolean;
	isMobile: boolean;
	isWeakDevice: boolean;
}

export function detectDeviceProfile(): DeviceProfile {
	if (typeof navigator === 'undefined') {
		return { hasWebGPU: false, isMobile: false, isWeakDevice: true };
	}

	const hasWebGPU = 'gpu' in navigator;
	const uaDataMobile =
		'userAgentData' in navigator
			? ((navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ?? false)
			: false;
	const uaMobile = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
	const isMobile = uaDataMobile || uaMobile;
	const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0;
	const hardwareConcurrency = navigator.hardwareConcurrency ?? 0;
	const isLowMemory = deviceMemory > 0 && deviceMemory <= 4;
	const isLowCpu = hardwareConcurrency > 0 && hardwareConcurrency <= 4;
	const isWeakDevice = isLowMemory || isLowCpu || !hasWebGPU;

	return { hasWebGPU, isMobile, isWeakDevice };
}
