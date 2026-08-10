const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/**/*.{js,jsx}',
    '!src/**/*.d.ts',
    '!src/app/favicon.ico',
    '!src/proxy.js',
  ],
  // Allow ESM-only packages (react-markdown v9+) to be transpiled
  transformIgnorePatterns: [
    '/node_modules/(?!(react-markdown|remark-gfm|remark-parse|unified|bail|is-plain-obj|trough|vfile|vfile-message|unist-util-stringify-position|mdast-util-from-markdown|micromark|decode-named-character-reference|character-entities|mdast-util-to-string|unist-util-visit|unist-util-visit-parents|unist-util-is|mdast-util-to-hast|trim-lines|hast-util-to-jsx-runtime|property-information|space-separated-tokens|comma-separated-tokens|web-namespaces|ccount|markdown-table|mdast-util-gfm|micromark-extension-gfm|micromark-util-character|micromark-util-chunked|micromark-util-classify-character|micromark-util-combine-extensions|micromark-util-decode-numeric-character-reference|micromark-util-decode-string|micromark-util-encode|micromark-util-html-tag-name|micromark-util-normalize-identifier|micromark-util-resolve-all|micromark-util-sanitize-uri|micromark-util-subtokenize|micromark-util-symbol|micromark-util-types|zwitch|longest-streak|devlop)/)',
  ],
};

module.exports = createJestConfig(config);
