// Biome checks hook usage; this catches React Compiler skips and zero output in real builds.
type SourceLocation = {
	start?: { line?: number; column?: number } | null;
};

type CompilerEvent = {
	kind: string;
	fnLoc?: SourceLocation | null;
	loc?: SourceLocation | null;
	reason?: string;
	detail?: {
		reason?: string;
		description?: string | null;
		options?: { reason?: string; description?: string | null };
	};
	data?: string;
};

type CompilerLogger = {
	logEvent(filename: string | null, event: CompilerEvent): void;
};

type CompilerOptions = {
	compilationMode: "infer";
	logger?: CompilerLogger;
	target: "19";
};

type BabelPlugin = [string, CompilerOptions];

const AUDIT_ENABLED = process.env.REACT_COMPILER_AUDIT === "1";

const formatLocation = (
	filename: string | null,
	event: CompilerEvent,
): string => {
	const start = event.fnLoc?.start ?? event.loc?.start;
	return `${filename ?? "unknown"}${start?.line ? `:${start.line}:${(start.column ?? 0) + 1}` : ""}`;
};

const formatReason = (event: CompilerEvent): string =>
	event.reason ??
	event.detail?.reason ??
	event.detail?.options?.reason ??
	event.detail?.description ??
	event.detail?.options?.description ??
	event.data ??
	"unknown reason";

export const reactCompilerPlugin = (scope: string): BabelPlugin => {
	const options: CompilerOptions = {
		compilationMode: "infer",
		target: "19",
	};
	if (!AUDIT_ENABLED) return ["babel-plugin-react-compiler", options];

	let successes = 0;
	const failures: string[] = [];
	const logger: CompilerLogger = {
		logEvent(filename, event) {
			if (event.kind === "CompileSuccess") {
				successes += 1;
				return;
			}

			if (
				event.kind === "CompileDiagnostic" ||
				event.kind === "CompileSkip" ||
				event.kind === "CompileError" ||
				event.kind === "PipelineError"
			) {
				failures.push(
					`${event.kind} ${formatLocation(filename, event)}: ${formatReason(event)}`,
				);
			}
		},
	};

	process.once("beforeExit", () => {
		const summary = `React Compiler audit (${scope}): ${successes} compiled, ${failures.length} failed`;
		if (successes > 0 && failures.length === 0) {
			console.log(summary);
			return;
		}

		console.error([summary, ...failures].join("\n"));
		process.exitCode = 1;
	});

	return ["babel-plugin-react-compiler", { ...options, logger }];
};
