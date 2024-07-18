const opinionated = require('opinionated-eslint-config');

module.exports = opinionated({
  typescript: {
    tsconfigPath: [ './tsconfig.json' ],
  },
}).append({
  rules: {
    // Using this for builtins
    'func-style': 'off',
    // Need this for debugging
    'no-console': 'off',
    // Many TODOs
    'unicorn/expiring-todo-comments': 'off',
  },
});
