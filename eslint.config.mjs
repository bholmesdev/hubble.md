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
	{
		files: ["packages/ui/src/editor/FindBar.tsx"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "react",
							importNames: [
								"useEffect",
								"useLayoutEffect",
								"useInsertionEffect",
							],
							message: "Use the shared command API for window shortcuts.",
						},
					],
				},
			],
			"no-restricted-syntax": [
				"error",
				{
					selector:
						"MemberExpression[property.name=/^use(Effect|LayoutEffect|InsertionEffect)$/], MemberExpression[property.value=/^use(Effect|LayoutEffect|InsertionEffect)$/]",
					message: "Use the shared command API for window shortcuts.",
				},
				{
					selector:
						"CallExpression[callee.property.name='addEventListener'][arguments.0.value=/^key(down|up|press)$/], CallExpression[callee.property.value='addEventListener'][arguments.0.value=/^key(down|up|press)$/]",
					message:
						"Use useWindowCommands for shortcuts or a JSX handler for local keyboard input.",
				},
			],
		},
	},
];
