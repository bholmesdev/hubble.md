import { appStore } from "./state";

export const tabsStore = appStore.select("tabs");
export const activeTabIdStore = tabsStore.select("activeTabId");
