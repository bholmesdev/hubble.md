export type ChatAccount = {
	issue?: "unreadable-credentials";
	connected: boolean;
	sharing: boolean;
	label: string | null;
	expiresAt: number | null;
};
