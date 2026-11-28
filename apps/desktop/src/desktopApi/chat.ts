export type ChatAccount = {
	issue?: "unreadable-credentials" | "refresh-unavailable";
	signingIn?: boolean;
	busy?: boolean;
	connected: boolean;
	sharing: boolean;
	label: string | null;
	expiresAt: number | null;
};
