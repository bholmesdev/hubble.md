type NativeKeyboardLayout = {
	getCurrentKeyboardLayout(): unknown;
	onDidChangeKeyboardLayout(callback: () => void): void;
};

export class KeyboardLayoutMonitor {
	qwertyCommandKeys: boolean;

	constructor(
		private readonly platform: string,
		private readonly onChange: (qwertyCommandKeys: boolean) => void,
	) {
		// If native detection fails, preserve existing macOS Command positions.
		this.qwertyCommandKeys = platform === "darwin";
	}

	async initialize(
		load: () => Promise<NativeKeyboardLayout> = () => import("native-keymap"),
	) {
		if (this.platform !== "darwin") return;
		try {
			const native = await load();
			const refresh = () => {
				try {
					const layout = native.getCurrentKeyboardLayout();
					if (
						!layout ||
						typeof layout !== "object" ||
						!("id" in layout) ||
						typeof layout.id !== "string"
					)
						throw new Error("Keyboard layout is unavailable");
					const enabled = layout.id === "com.apple.keylayout.DVORAK-QWERTYCMD";
					if (this.qwertyCommandKeys === enabled) return;
					this.qwertyCommandKeys = enabled;
					this.onChange(enabled);
				} catch (error) {
					console.warn(
						"Could not read keyboard layout; keeping shortcut mode",
						error,
					);
				}
			};
			refresh();
			native.onDidChangeKeyboardLayout(refresh);
		} catch (error) {
			console.warn("Native keyboard layout detection is unavailable", error);
		}
	}
}
