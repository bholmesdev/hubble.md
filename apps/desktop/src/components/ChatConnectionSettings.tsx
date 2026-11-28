import { ChatConnectionControls } from "./ChatConnectionControls";
import { SettingsSection } from "./SettingsDialog";

export function ChatConnectionSettings() {
	return (
		<SettingsSection title="Chat" description="Connect your ChatGPT account.">
			<ChatConnectionControls />
		</SettingsSection>
	);
}
