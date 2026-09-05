/**
 * Signals that a mounted app has drawn something worth looking at.
 *
 * The boot indicator cannot infer this from the DOM. A canvas exists and is
 * sized well before WebGL draws into it, so waiting for a canvas cleared the
 * indicator over a blank globe; waiting for a *painted* canvas then left the
 * home page — which has no canvas at all — spinning until its timeout.
 *
 * Each entry says when it is ready instead: the scene from its first rendered
 * frame, and DOM-only surfaces as soon as they mount.
 */
export const APP_READY_EVENT = "orbit-studio:ready";

export function signalAppReady(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(APP_READY_EVENT));
}
