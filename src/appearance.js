import { useSyncExternalStore } from "react";

// Subscribe without remounting editors or widgets: switching appearance must
// never reset a draft, a revealed answer or an interactive example.
const media = window.matchMedia("(prefers-color-scheme: dark)");
const subscribe = (notify) => {
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
export const currentAppearance = () => (media.matches ? "dark" : "light");
export const useAppearance = () =>
  useSyncExternalStore(subscribe, currentAppearance);

export function surfaceTokens() {
  const style = getComputedStyle(document.documentElement);
  return (name) => style.getPropertyValue("--" + name).trim();
}
