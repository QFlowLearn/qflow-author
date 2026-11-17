import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';

// Preserve the previous recommended correctness/TypeScript/JSX checks. Explicit any remains
// governed by the unchanged maintainability ratchet; framework-only Fresh rules are retired.
export default ts.config(
  {
    ignores: [
      'node_modules/**',
      'build/**',
      '_fresh/**',
      '.artifacts/**',
      '.migration-build/**',
      '.migration-inventory/**',
      'tests/fixtures/**',
      'vendor/**',
      'output/**',
      'deploy/cloudflare/private/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.worker } },
    plugins: { react, 'react-hooks': hooks },
    settings: { react: { version: '18.0' } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-useless-escape': 'off',
      // TypeScript owns unused declarations, including values intentionally used only in type queries.
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'as' }],
      '@typescript-eslint/adjacent-overload-signatures': 'error',
      '@typescript-eslint/no-namespace': ['error', {
        allowDeclarations: true,
        allowDefinitionFiles: true,
      }],
      '@typescript-eslint/no-empty-object-type': ['error', {
        allowInterfaces: 'with-single-extends',
        allowObjectTypes: 'always',
      }],
      'react/button-has-type': 'error',
      'react/jsx-boolean-value': 'error',
      'react/jsx-curly-brace-presence': ['error', { props: 'never', children: 'never' }],
      'react/jsx-key': 'error',
      'react/jsx-no-comment-textnodes': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-useless-fragment': ['error', { allowExpressions: true }],
      'react/jsx-no-undef': 'error',
      'react/no-children-prop': 'error',
      'react/no-danger': 'error',
      'react/no-danger-with-children': 'error',
      'react/void-dom-elements-no-children': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-var': 'error',
      'prefer-const': 'error',
      'require-yield': 'error',
      'require-await': 'error',
      'no-control-regex': 'error',
      'no-restricted-imports': ['error', {
        patterns: ['fresh', 'fresh/*', '@fresh/*', 'jsr:*', 'npm:*'],
      }],
      'no-restricted-globals': ['error', {
        name: 'Deno',
        message: 'Use the owned Node or Worker runtime API.',
      }],
    },
  },
);
