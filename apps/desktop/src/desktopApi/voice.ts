export type VoiceEvent = {
	id: string;
	status: "starting" | "listening" | "stopping" | "stopped" | "error";
	text?: string;
	level?: number;
	error?: string;
};
