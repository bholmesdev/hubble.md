export function windowControlsInset(platform: string) {
	return platform === "darwin"
		? "0px"
		: "calc(100vw - env(titlebar-area-width, calc(100vw - 138px)))";
}
