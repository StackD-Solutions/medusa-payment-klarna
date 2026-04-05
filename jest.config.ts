import type {Config} from 'jest'

const config: Config = {
	testEnvironment: 'node',
	roots: ['<rootDir>/__tests__'],
	moduleFileExtensions: ['ts', 'tsx', 'js'],
	transform: {
		'^.+\\.tsx?$': '@swc/jest'
	},
	collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '!src/modules/payment-klarna/index.ts'],
	coverageThreshold: {
		global: {
			branches: 100,
			functions: 100,
			lines: 100,
			statements: 100
		}
	}
}

export default config
