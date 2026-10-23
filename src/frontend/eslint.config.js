import tseslint from "typescript-eslint";

/**
 * ESLint flat config for the frontend TypeScript sources.
 */
export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
