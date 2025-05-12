// eslint.config.cjs
const eslintPluginNode = require('eslint-plugin-node');

module.exports = [
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
