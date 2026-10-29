"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "magic";

/** Only same-site paths are allowed as the post-login destination. */
function nextUrl() {
  const n = new URLSearchParams(window.location.search).get("next") || "/#overview";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/#overview";
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  // Already signed in (or arriving from an email link): go straight in.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => { if (data.session) window.location.replace(nextUrl()); });
    const { data } = sb.auth.onAuthStateChange((_e, session) => { if (session) window.location.replace(nextUrl()); });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setMsg(null);
    const redirectTo = `${window.location.origin}/login?next=${encodeURIComponent(nextUrl())}`;
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        if (!name.trim()) throw new Error("Enter your name");
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name: name.trim() }, emailRedirectTo: redirectTo } });
        if (error) throw error;
        if (!data.session) setMsg({ text: "Check your email to confirm your account, then come back here." });
      } else {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        setMsg({ text: "We sent you a sign-in link. Open it on this device." });
      }
    } catch (err) {
      setMsg({ text: (err as Error).message || "Something went wrong", bad: true });
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Email me a sign-in link";

  return (
    <div className="signin">
      <div>
        <Link className="wordmark" href="/">Superfinancials</Link>
        <div className="md">
          <header><h3>{title}</h3></header>
          {!supabaseConfigured ? (
            <div className="mb">
              <p className="note" style={{ margin: 0 }}>
                Supabase is not configured. Set <b>NEXT_PUBLIC_SUPABASE_URL</b> and{" "}
                <b>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</b> in <code>.env.local</code>, or{" "}
                <Link href="/">open the app</Link> in browser-only mode.
              </p>
            </div>
          ) : (
            <form className="mb" onSubmit={submit}>
              {mode === "signup" && (
                <label className="f"><span>Name</span>
                  <input className="inp" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
                </label>
              )}
              <label className="f"><span>Email</span>
                <input className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </label>
              {mode !== "magic" && (
                <label className="f"><span>Password</span>
                  <input className="inp" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required />
                </label>
              )}
              {msg && <p className={msg.bad ? "note dn" : "note"} style={{ margin: 0 }} role="status">{msg.text}</p>}
              <button className="btn pri" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
                {busy ? "Please wait…" : title}
              </button>
              <div className="row" style={{ justifyContent: "space-between" }}>
                {mode !== "signin" && <button type="button" className="btn ghost sm" onClick={() => setMode("signin")}>I have an account</button>}
                {mode !== "signup" && <button type="button" className="btn ghost sm" onClick={() => setMode("signup")}>Create an account</button>}
                {mode !== "magic" && <button type="button" className="btn ghost sm" onClick={() => setMode("magic")}>Use an email link</button>}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
