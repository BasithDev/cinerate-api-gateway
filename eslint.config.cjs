// eslint.config.js
const eslintPluginNode = require('eslint-plugin-node');

export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
    },
    plugins: {
      node: eslintPluginNode,
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'node/no-unsupported-features/es-syntax': 'off',
    },
  },
];
