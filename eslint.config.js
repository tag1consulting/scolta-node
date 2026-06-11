import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "assets/**",
      "coverage/**",
      "src/index/stemmer-wasm/**", // vendored wasm-pack output (generated)
      "tools/**", // Rust crate sources for the stemmer WASM/golden
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Root config files live outside the tsconfig project.
          allowDefaultProject: ["*.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Plain-JS files (scripts, this config) are not part of the TS project —
    // type-aware rules cannot run on them.
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["**/*.mjs", "scripts/**"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Generated artifacts (canonical source is scolta-core/scolta-php):
    // JSON.parse of an embedded literal is inherently untyped.
    files: ["src/**/*.generated.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    // Tests poke at internals and fixtures through `any` on purpose; the
    // unsafe-* family would force casts with no safety gain. The high-value
    // type-aware rules (no-floating-promises, no-misused-promises) stay on.
    files: ["tests/**"],
    rules: {
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
