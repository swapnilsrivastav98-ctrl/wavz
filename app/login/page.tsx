"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      const from = searchParams.get("from") ?? "/";
      router.push(from);
      router.refresh();
    } else {
      setError("Incorrect password");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="neu-raised w-full max-w-sm rounded-3xl p-8"
    >
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-zinc-50">
        Wavz
      </h1>
      <p className="mb-6 text-sm text-zinc-400">Your personal audiobook library</p>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="neu-inset w-full rounded-xl px-4 py-3 text-zinc-100 outline-none placeholder:text-zinc-500"
      />
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={loading || password.length === 0}
        className="accent-gradient accent-glow neu-pressable mt-4 w-full rounded-xl px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Checking..." : "Enter"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-background p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
