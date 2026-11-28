import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
	{
		files: [
			"apps/*/src/**/*.{js,jsx,ts,tsx}",
			"packages/*/src/**/*.{js,jsx,ts,tsx}",
		],
		languageOptions: { parser: tsParser },
		linterOptions: { noInlineConfig: true },
		plugins: { "react-hooks": reactHooks },
		rules: { "react-hooks/set-state-in-effect": "error" },
	},
];
