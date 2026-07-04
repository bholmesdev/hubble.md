const URL_KEY = "hubble.connection.url";
const TOKEN_KEY = "hubble.connection.token";
const WORKSPACE_ID_KEY = "hubble.connection.workspaceId";

export type StoredConnection = {
	url: string;
	token: string;
	workspaceId: string | null;
};

export function readConnection(): StoredConnection | null {
	const url = localStorage.getItem(URL_KEY);
	const token = localStorage.getItem(TOKEN_KEY);
	if (!url || !token) return null;
	return {
		url,
		token,
		workspaceId: localStorage.getItem(WORKSPACE_ID_KEY),
	};
}

export function saveConnection(url: string, token: string): void {
	localStorage.setItem(URL_KEY, url);
	localStorage.setItem(TOKEN_KEY, token);
}

export function saveWorkspace(id: string): void {
	localStorage.setItem(WORKSPACE_ID_KEY, id);
}

export function clearWorkspace(): void {
	localStorage.removeItem(WORKSPACE_ID_KEY);
}

export function disconnect(): void {
	localStorage.removeItem(URL_KEY);
	localStorage.removeItem(TOKEN_KEY);
	clearWorkspace();
}
