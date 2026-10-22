"use client";

export function SignOutButton() {
  return (
    <button className="underline" onClick={() => navigator.serviceWorker?.controller?.postMessage("clear")}>
      Sign out
    </button>
  );
}
