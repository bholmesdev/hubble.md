import type {
	StateObject,
	StatePrimitive,
	StoreMiddleware,
} from "@simplestack/store";

export function localStoragePersist<T extends StateObject | StatePrimitive>(
	key: string,
	serialize?: (state: T) => unknown,
): StoreMiddleware<T> {
	return () => ({
		set: (next) => (setter) => {
			next((current) => {
				const nextState =
					typeof setter === "function" ? setter(current) : setter;
				const toStore = serialize ? serialize(nextState) : nextState;
				try {
					localStorage.setItem(key, JSON.stringify(toStore));
				} catch (error) {
					// Persistence is best-effort; a storage quota/security error
					// must not prevent the in-memory state update.
					console.warn(`Failed to persist "${key}" to localStorage`, error);
				}
				return nextState;
			});
		},
	});
}
