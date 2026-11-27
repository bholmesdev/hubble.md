export type ChatAccount = {
	issue?: "unreadable-credentials";
	signingIn?: boolean;
	busy?: boolean;
	connected: boolean;
	sharing: boolean;
	label: string | null;
	expiresAt: number | null;
};
