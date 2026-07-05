"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="neu-raised neu-pressable rounded-full px-4 py-2 text-sm text-zinc-300 hover:text-white"
    >
      Log out
    </button>
  );
}
