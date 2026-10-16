import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import expo from 'eslint-plugin-expo'
import { flatConfigs as importConfigs } from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import globals from 'globals'
import react from '@eslint-react/eslint-plugin'
import hooks from 'eslint-plugin-react-hooks'
import sonarjs from 'eslint-plugin-sonarjs'
import { configs, parser, plugin } from 'typescript-eslint'

// Preserve https://github.com/fishonfire/eslint-config-fishonfire rules alongside Expo checks.
// Formatting rules use maintained Stylistic equivalents. The return-padding rule
// also replaces the retired newline-before-return rule.
const fishonfireRules = {
  '@stylistic/indent': ['error', 2, { SwitchCase: 0 }],
  '@stylistic/linebreak-style': ['error', 'unix'],
  '@stylistic/quotes': ['error', 'single'],
  '@stylistic/semi': ['error', 'never'],
  '@stylistic/no-trailing-spaces': 'error',
  '@stylistic/comma-dangle': ['error', 'never'],
  'arrow-body-style': ['error', 'as-needed'],
  '@stylistic/eol-last': 'error',
  '@stylistic/space-before-function-paren': ['error', 'always'],
  '@stylistic/jsx-quotes': ['error', 'prefer-single'],
  '@stylistic/lines-between-class-members': ['error', 'always'],
  '@stylistic/multiline-ternary': ['error', 'always-multiline'],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-useless-constructor': 'error',
  'no-var': 'error',
  '@stylistic/space-before-blocks': 'error',
  'prefer-template': 'error',
  '@stylistic/jsx-max-props-per-line': ['error', { maximum: { single: 1, multi: 1 } }],
  '@stylistic/jsx-first-prop-new-line': ['error', 'multiline-multiprop'],
  '@stylistic/jsx-closing-bracket-location': ['error', 'line-aligned'],
  '@stylistic/keyword-spacing': ['error', { before: true, after: true }],
  '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 1, maxBOF: 0 }],
  '@stylistic/padding-line-between-statements': [
    'error',
    { blankLine: 'always', prev: '*', next: 'return' },
    { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
    { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] }
  ],
  '@stylistic/jsx-newline': ['error', { prevent: false }],
  '@stylistic/operator-linebreak': ['error', 'after', { overrides: { '?': 'before', ':': 'before', '|': 'before', '&': 'before' } }],
  'require-yield': 'off',
  'react-hooks/rules-of-hooks': 'error'
}

// Preserve the original TypeScript rule policy using maintained replacements.
const typescriptRules = {
  '@typescript-eslint/adjacent-overload-signatures': 'error',
  '@typescript-eslint/ban-ts-comment': 'error',
  'no-array-constructor': 'off',
  '@typescript-eslint/no-array-constructor': 'error',
  'no-empty-function': 'off',
  '@typescript-eslint/no-empty-function': 'error',
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-extra-non-null-assertion': 'error',
  '@stylistic/no-extra-semi': 'error',
  '@typescript-eslint/no-inferrable-types': 'error',
  'no-loss-of-precision': 'error',
  '@typescript-eslint/no-misused-new': 'error',
  '@typescript-eslint/no-namespace': 'error',
  '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
  '@typescript-eslint/no-non-null-assertion': 'warn',
  '@typescript-eslint/no-this-alias': 'error',
  '@typescript-eslint/no-unnecessary-type-constraint': 'error',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['warn', { vars: 'all', args: 'none', ignoreRestSiblings: true, caughtErrors: 'all' }],
  '@typescript-eslint/no-require-imports': 'error',
  '@typescript-eslint/prefer-as-const': 'error',
  '@typescript-eslint/prefer-namespace-keyword': 'error',
  '@typescript-eslint/triple-slash-reference': 'error',
  '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
  '@typescript-eslint/no-unsafe-function-type': 'error',
  '@typescript-eslint/no-wrapper-object-types': 'error'
}

// Keep the original Sonar recommended rule scope; current presets add unrelated policies.
const sonarRules = {
  'sonarjs/cognitive-complexity': 'error',
  'sonarjs/elseif-without-else': 'off',
  'sonarjs/max-switch-cases': 'error',
  'sonarjs/no-all-duplicated-branches': 'error',
  'sonarjs/no-collapsible-if': 'error',
  'sonarjs/no-collection-size-mischeck': 'error',
  'sonarjs/no-duplicate-string': 'error',
  'sonarjs/no-duplicated-branches': 'error',
  'sonarjs/no-element-overwrite': 'error',
  'sonarjs/no-empty-collection': 'error',
  'sonarjs/no-extra-arguments': 'error',
  'sonarjs/no-gratuitous-expressions': 'error',
  'sonarjs/no-identical-conditions': 'error',
  'sonarjs/no-identical-expressions': 'error',
  'sonarjs/no-identical-functions': 'error',
  'sonarjs/no-ignored-return': 'error',
  'sonarjs/no-inverted-boolean-check': 'off',
  'sonarjs/no-nested-switch': 'error',
  'sonarjs/no-nested-template-literals': 'error',
  'sonarjs/no-redundant-boolean': 'error',
  'sonarjs/no-redundant-jump': 'error',
  'sonarjs/no-same-line-conditional': 'error',
  'sonarjs/no-small-switch': 'error',
  'sonarjs/no-unused-collection': 'error',
  'sonarjs/no-use-of-empty-return-value': 'error',
  'sonarjs/no-useless-catch': 'error',
  'sonarjs/non-existent-operator': 'error',
  'sonarjs/prefer-immediate-return': 'error',
  'sonarjs/prefer-object-literal': 'error',
  'sonarjs/prefer-single-boolean-return': 'error',
  'sonarjs/prefer-while': 'error',
  'no-unreachable-loop': 'error'
}

const reactRules = {
  '@eslint-react/no-missing-component-display-name': 'error',
  '@eslint-react/no-missing-context-display-name': 'error',
  '@eslint-react/no-missing-key': 'error',
  '@eslint-react/jsx-no-comment-textnodes': 'error',
  '@eslint-react/jsx-no-children-prop': 'error',
  '@eslint-react/dom-no-dangerously-set-innerhtml-with-children': 'error',
  '@eslint-react/no-component-will-mount': 'error',
  '@eslint-react/no-component-will-receive-props': 'error',
  '@eslint-react/no-component-will-update': 'error',
  '@eslint-react/no-direct-mutation-state': 'error',
  '@eslint-react/dom-no-find-dom-node': 'error',
  '@eslint-react/dom-no-render-return-value': 'error',
  '@eslint-react/dom-no-unknown-property': 'error',
  '@eslint-react/dom-no-unsafe-target-blank': 'error',
  ...hooks.configs.flat.recommended.rules
}

// Expo 57's standalone rules and import conventions, with import-x for ESLint 10.
const expoRules = {
  'expo/use-dom-exports': 'error',
  'expo/no-env-var-destructuring': 'error',
  'expo/no-dynamic-env-var': 'error',
  'import-x/default': 'off',
  'import-x/first': 'warn',
  eqeqeq: ['warn', 'smart'],
  'no-extend-native': 'warn',
  'no-extra-bind': 'warn',
  'no-unused-expressions': ['warn', { allowShortCircuit: true, enforceForJSX: true }],
  'unicode-bom': ['warn', 'never'],
  // Preserve contextual errors whose original details are included in the message.
  'preserve-caught-error': 'off'
}

const extensions = ['.cjs', '.mjs', '.js', '.jsx', '.ts', '.tsx', '.d.ts']
const allExtensions = ['.android', '.ios', '.web', '.native', ''].flatMap(platform =>
  extensions.map(extension => `${platform}${extension}`)
)

export default [
  { ignores: ['dist/**', 'plugin/build/**', 'android/app/build/**', 'babel.config.js', 'metro.config.js'] },
  js.configs.recommended,
  importConfigs.recommended,
  importConfigs.errors,
  importConfigs.typescript,
  ...configs.recommended.map(config => ({ ...config, files: ['**/*.ts', '**/*.tsx'] })),
  stylistic.configs['disable-legacy'],
  {
    files: ['**/*.{js,cjs,mjs,jsx,ts,tsx}'],
    plugins: { '@stylistic': stylistic, '@eslint-react': react, 'react-hooks': hooks, expo, sonarjs },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, __DEV__: 'readonly', ErrorUtils: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    settings: {
      'import-x/extensions': allExtensions,
      'import-x/ignore': ['node_modules[\\/]+@?react-native'],
      'import-x/resolver-next': [createTypeScriptImportResolver({ extensions: allExtensions })]
    },
    rules: { ...expoRules, ...reactRules, ...sonarRules, ...fishonfireRules }
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser },
    plugins: { '@typescript-eslint': plugin },
    rules: {
      '@typescript-eslint/array-type': ['warn', { default: 'array' }],
      '@typescript-eslint/consistent-type-assertions': ['warn', { assertionStyle: 'as', objectLiteralTypeAssertions: 'allow' }],
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': ['warn', { allowShortCircuit: true, enforceForJSX: true }],
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'warn',
      ...typescriptRules,
      ...fishonfireRules
    }
  },
  { files: ['**/*.d.ts'], rules: { 'import-x/order': 'off' } }
]
