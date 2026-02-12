import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'happy-dom',
		include: ['tests/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			thresholds: {
				lines: 80,
				functions: 85,
				branches: 60,
				statements: 75
			}
		}
	}
});
