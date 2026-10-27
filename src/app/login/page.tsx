"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    // Only same-site paths, so a crafted link can't bounce a signed-in owner elsewhere.
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    if (res.ok) window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    else setError((await res.json()).error ?? "Login failed");
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-16 max-w-sm space-y-3 rounded-lg border border-line bg-panel p-6">
      <h1 className="font-semibold">Sign in</h1>
      <input
        type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)}
        className="block w-full rounded-md border border-line bg-bg px-3 py-2 text-sm" placeholder="Password"
      />
      {error && <p className="text-sm text-bad">{error}</p>}
      <button className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white dark:text-black">Sign in</button>
    </form>
  );
}
