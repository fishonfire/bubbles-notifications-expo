// Match https://github.com/fishonfire/eslint-config-fishonfire on top of Expo.
const fishonfireRules = {
  indent: ['error', 2],
  'linebreak-style': ['error', 'unix'],
  quotes: ['error', 'single'],
  semi: ['error', 'never'],
  'no-trailing-spaces': 'error',
  'comma-dangle': ['error', 'never'],
  'arrow-body-style': ['error', 'as-needed'],
  'eol-last': 'error',
  'space-before-function-paren': ['error', 'always'],
  'jsx-quotes': ['error', 'prefer-single'],
  'lines-between-class-members': ['error', 'always'],
  'multiline-ternary': ['error', 'always-multiline'],
  'newline-before-return': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-useless-constructor': 'error',
  'no-var': 'error',
  'space-before-blocks': 'error',
  'prefer-template': 'error',
  'react/jsx-max-props-per-line': ['error', { maximum: { single: 1, multi: 1 } }],
  'react/jsx-first-prop-new-line': ['error', 'multiline-multiprop'],
  'react/jsx-closing-bracket-location': ['error', 'line-aligned'],
  'keyword-spacing': ['error', { before: true, after: true }],
  'react/jsx-uses-react': 'off',
  'react/react-in-jsx-scope': 'off',
  'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 1, maxBOF: 0 }],
  'padding-line-between-statements': [
    'error',
    { blankLine: 'always', prev: '*', next: 'return' },
    { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
    { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] }
  ],
  'react/jsx-newline': ['error', { prevent: false }],
  'operator-linebreak': ['error', 'after', { overrides: { '?': 'before', ':': 'before' } }],
  'require-yield': 'off',
  'react-hooks/rules-of-hooks': 'error'
}

// TypeScript ESLint 5 recommended rules, using TypeScript ESLint 8 replacements for retired rules.
// Expo 57 uses TypeScript ESLint 8; core rules now cover extra semicolons and precision.
const typescriptRules = {
  '@typescript-eslint/adjacent-overload-signatures': 'error',
  '@typescript-eslint/ban-ts-comment': 'error',
  'no-array-constructor': 'off',
  '@typescript-eslint/no-array-constructor': 'error',
  'no-empty-function': 'off',
  '@typescript-eslint/no-empty-function': 'error',
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-extra-non-null-assertion': 'error',
  'no-extra-semi': 'error',
  '@typescript-eslint/no-inferrable-types': 'error',
  'no-loss-of-precision': 'error',
  '@typescript-eslint/no-misused-new': 'error',
  '@typescript-eslint/no-namespace': 'error',
  '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
  '@typescript-eslint/no-non-null-assertion': 'warn',
  '@typescript-eslint/no-this-alias': 'error',
  '@typescript-eslint/no-unnecessary-type-constraint': 'error',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': 'warn',
  '@typescript-eslint/no-var-requires': 'error',
  '@typescript-eslint/prefer-as-const': 'error',
  '@typescript-eslint/prefer-namespace-keyword': 'error',
  '@typescript-eslint/triple-slash-reference': 'error',
  '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
  '@typescript-eslint/no-unsafe-function-type': 'error',
  '@typescript-eslint/no-wrapper-object-types': 'error'
}

module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  extends: ['expo', 'eslint:recommended', 'plugin:react/recommended', 'plugin:sonarjs/recommended'],
  plugins: ['react-hooks'],
  ignorePatterns: ['dist/', 'plugin/build/', 'babel.config.js', 'metro.config.js'],
  globals: { __DEV__: 'readonly', require: 'readonly' },
  settings: { react: { version: 'detect' } },
  rules: fishonfireRules,
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      extends: ['plugin:@typescript-eslint/eslint-recommended'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      rules: { ...typescriptRules, ...fishonfireRules }
    }
  ]
}
