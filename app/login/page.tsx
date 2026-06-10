"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message || "Login failed.");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-badge"><ShieldCheck size={26} /></div>
        <h1 className="login-title">Shathi Sheba Admin</h1>
        <p className="login-sub">Sign in to the management console</p>

        <label className="login-label">Email</label>
        <input
          className="login-input"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@digigramventures.com"
          required
        />

        <label className="login-label">Password</label>
        <input
          className="login-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
        />

        {error ? <div className="login-error">{error}</div> : null}

        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? <Loader2 size={18} className="spin" /> : "Sign in"}
        </button>
      </form>
    </main>
  );
}
