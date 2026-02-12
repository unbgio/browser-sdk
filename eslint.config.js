import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
	{
		files: ['**/*.ts'],
		ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				projectService: true
			}
		},
		plugins: {
			'@typescript-eslint': tsPlugin
		},
		rules: {
			'@typescript-eslint/consistent-type-imports': 'error',
			'@typescript-eslint/no-floating-promises': 'error'
		}
	}
];
