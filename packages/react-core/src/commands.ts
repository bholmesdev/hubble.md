import { type CommandId, getCommandBinding } from "@hubble.md/editor";
import { keymatch } from "keymatch";
import { useEffect, useEffectEvent } from "react";

type KeyCommand = (
	| { command: CommandId }
	| { shortcut: string }
	| { key: string }
) & {
	enabled: () => boolean;
	run: () => void;
};

export function useWindowCommands(commands: readonly KeyCommand[]) {
	const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
		for (const command of commands) {
			if (!matches(event, command) || !command.enabled()) continue;
			event.preventDefault();
			command.run();
			break;
		}
	});

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => onKeyDown(event);
		return subscribe(window, handleKeyDown);
	}, []);
}

function matches(event: KeyboardEvent, command: KeyCommand) {
	if ("key" in command) return event.key === command.key;
	const binding =
		"command" in command
			? getCommandBinding(command.command)
			: command.shortcut;
	return binding != null && keymatch(event, binding);
}

type KeyHandler = (event: KeyboardEvent) => void;
const windows = new WeakMap<
	Window,
	{
		handlers: Set<KeyHandler>;
		dispatch: KeyHandler;
	}
>();

function subscribe(target: Window, handler: KeyHandler) {
	let subscription = windows.get(target);
	if (!subscription) {
		const handlers = new Set<KeyHandler>();
		const dispatch = (event: KeyboardEvent) => {
			for (const run of [...handlers]) {
				if (event.defaultPrevented) break;
				if (handlers.has(run)) run(event);
			}
		};
		subscription = { handlers, dispatch };
		windows.set(target, subscription);
		target.addEventListener("keydown", dispatch);
	}
	const { handlers, dispatch } = subscription;
	handlers.add(handler);
	return () => {
		handlers.delete(handler);
		if (handlers.size > 0) return;
		target.removeEventListener("keydown", dispatch);
		windows.delete(target);
	};
}
