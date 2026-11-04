"use client";
import {useEffect, useState} from "react";
import Link from "next/link";

/** Nav entry for customer accounts. Renders nothing while loading, when
 *  customer accounts are disabled on this deployment (503), and links to
 *  /account once a session exists — so the menu never advertises a login
 *  that is not actually available. */
export function AccountNavLink() {
  const [state, setState] = useState<"loading" | "off" | "guest" | "user">("loading");
  useEffect(() => {
    void fetch("/api/account/session", {cache: "no-store"})
      .then(async (response) => {
        if (response.status === 503) { setState("off"); return; }
        if (!response.ok) { setState("guest"); return; }
        const data: unknown = await response.json().catch(() => null);
        const user = data && typeof data === "object"
          ? (data as {user?: unknown}).user : null;
        setState(user ? "user" : "guest");
      })
      .catch(() => setState("guest"));
  }, []);
  if (state === "loading" || state === "off") return null;
  return state === "user"
    ? <Link href="/account">Tài khoản</Link>
    : <Link href="/login">Đăng nhập</Link>;
}
