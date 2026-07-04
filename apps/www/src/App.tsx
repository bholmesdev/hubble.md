import { useState } from "react";
import {
	BrowserRouter,
	Navigate,
	Route,
	Routes,
	useLocation,
	useNavigate,
	useParams,
} from "react-router";
import { disconnect, readConnection } from "./connection/connection";
import { ConnectScreen } from "./screens/ConnectScreen";
import { OpenWorkspaceScreen } from "./screens/OpenWorkspaceScreen";
import { AppShell } from "./shell/AppShell";
import { workspaceStore } from "./store/state";

type Connection = {
	url: string;
	token: string;
	workspaceId: string | null;
};

function initialConnection(): Connection | null {
	const testConnection = readTestBootstrap();
	if (testConnection) return testConnection;
	return readConnection();
}

// Agent test bootstrap: navigating to /?test=1 skips the connect + workspace
// screens by reading VITE_TEST_CONVEX_URL / VITE_TEST_WORKSPACE_ID from
// apps/www/.env.local. Without the query param the env vars are inert, so
// human dev sessions are unaffected.
function readTestBootstrap(): Connection | null {
	const params = new URLSearchParams(window.location.search);
	if (params.get("test") !== "1") return null;
	const url = import.meta.env.VITE_TEST_CONVEX_URL;
	const workspaceId = import.meta.env.VITE_TEST_WORKSPACE_ID;
	const token = import.meta.env.VITE_TEST_TOKEN;
	if (!url || !workspaceId || !token) {
		console.warn(
			"?test=1 set but VITE_TEST_CONVEX_URL / VITE_TEST_WORKSPACE_ID / VITE_TEST_TOKEN are missing — falling back to normal routing.",
		);
		return null;
	}
	return { url, token, workspaceId };
}

export default function App() {
	return (
		<BrowserRouter>
			<AppRoutes />
		</BrowserRouter>
	);
}

function AppRoutes() {
	const [connection, setConnection] = useState<Connection | null>(
		initialConnection,
	);
	const navigate = useNavigate();
	const location = useLocation();

	const handleDisconnect = () => {
		disconnect();
		setConnection(null);
		navigate("/", { replace: true });
	};

	const handleConnected = (url: string, token: string) => {
		setConnection({
			url,
			token,
			workspaceId: getWorkspaceIdFromPath(location.pathname),
		});
	};

	const handleWorkspaceLoaded = (workspaceId: string) => {
		setConnection((current) =>
			current ? { ...current, workspaceId } : current,
		);
	};

	return (
		<Routes>
			<Route
				path="/"
				element={
					<HomeRoute
						connection={connection}
						onConnected={handleConnected}
						onSelected={(workspaceId) => {
							handleWorkspaceLoaded(workspaceId);
							navigate(workspaceRoute(workspaceId));
						}}
						onDisconnect={handleDisconnect}
					/>
				}
			/>
			<Route
				path="/w/:workspaceId"
				element={
					<WorkspaceRoute
						connection={connection}
						filePath={null}
						onConnected={handleConnected}
						onWorkspaceLoaded={handleWorkspaceLoaded}
						onDisconnect={handleDisconnect}
					/>
				}
			/>
			<Route
				path="/w/:workspaceId/f/*"
				element={
					<WorkspaceRoute
						connection={connection}
						onConnected={handleConnected}
						onWorkspaceLoaded={handleWorkspaceLoaded}
						onDisconnect={handleDisconnect}
					/>
				}
			/>
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	);
}

function HomeRoute({
	connection,
	onConnected,
	onSelected,
	onDisconnect,
}: {
	connection: Connection | null;
	onConnected: (url: string, token: string) => void;
	onSelected: (workspaceId: string) => void;
	onDisconnect: () => void;
}) {
	if (!connection) {
		return <ConnectScreen onConnected={onConnected} />;
	}

	if (connection.workspaceId) {
		const lastOpenedPath =
			workspaceStore.get().lastOpenedPaths[connection.workspaceId];
		return (
			<Navigate
				to={
					lastOpenedPath
						? workspaceFileRoute(connection.workspaceId, lastOpenedPath)
						: workspaceRoute(connection.workspaceId)
				}
				replace
			/>
		);
	}

	return (
		<OpenWorkspaceScreen
			url={connection.url}
			token={connection.token}
			onSelected={onSelected}
			onDisconnect={onDisconnect}
		/>
	);
}

function WorkspaceRoute({
	connection,
	filePath,
	onConnected,
	onWorkspaceLoaded,
	onDisconnect,
}: {
	connection: Connection | null;
	filePath?: string | null;
	onConnected: (url: string, token: string) => void;
	onWorkspaceLoaded: (workspaceId: string) => void;
	onDisconnect: () => void;
}) {
	const params = useParams();
	const navigate = useNavigate();
	const workspaceId = params.workspaceId;
	const routeFilePath =
		filePath === undefined ? (params["*"] ?? null) : filePath;

	if (!workspaceId) return <Navigate to="/" replace />;

	if (!connection) {
		return <ConnectScreen onConnected={onConnected} />;
	}

	return (
		<AppShell
			url={connection.url}
			token={connection.token}
			workspaceId={workspaceId}
			filePath={routeFilePath}
			onSelectFile={(path) => {
				navigate(workspaceFileRoute(workspaceId, path));
			}}
			onSwitch={(id) => {
				navigate(workspaceRoute(id));
			}}
			onWorkspaceLoaded={onWorkspaceLoaded}
			onDisconnect={onDisconnect}
		/>
	);
}

function workspaceRoute(workspaceId: string): string {
	return `/w/${encodeURIComponent(workspaceId)}`;
}

function workspaceFileRoute(workspaceId: string, path: string): string {
	return `${workspaceRoute(workspaceId)}/f/${path
		.split("/")
		.map(encodeURIComponent)
		.join("/")}`;
}

function getWorkspaceIdFromPath(pathname: string): string | null {
	const match = /^\/w\/([^/]+)/.exec(pathname);
	return match ? decodeURIComponent(match[1]) : null;
}
