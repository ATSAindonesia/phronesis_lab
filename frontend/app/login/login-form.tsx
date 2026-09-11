"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import "@material/web/textfield/outlined-text-field.js";
import "@material/web/button/filled-button.js";

declare global {
  namespace React.JSX {
    interface IntrinsicElements {
      "md-outlined-text-field": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        label?: string;
        type?: string;
        value?: string;
        required?: boolean;
      };
      "md-filled-button": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        type?: string;
        disabled?: boolean;
      };
    }
  }
}

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Login failed");
        return;
      }

      router.push("/lab");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
      style={
        {
          "--md-sys-color-primary": "#ffffff",
          "--md-sys-color-on-primary": "#1a1a1a",
          "--md-sys-color-on-surface": "#ffffff",
          "--md-sys-color-on-surface-variant": "rgba(255,255,255,0.85)",
          "--md-sys-color-outline": "rgba(255,255,255,0.6)",
          "--md-outlined-text-field-input-text-color": "#ffffff",
          "--md-outlined-text-field-label-text-color": "rgba(255,255,255,0.9)",
          "--md-outlined-text-field-outline-color": "rgba(255,255,255,0.6)",
          "--md-outlined-text-field-hover-outline-color": "#ffffff",
          "--md-outlined-text-field-focus-outline-color": "#ffffff",
          "--md-outlined-text-field-caret-color": "#ffffff",
        } as React.CSSProperties
      }
    >
      <div className="flex flex-col gap-4">
        <md-outlined-text-field
          label="Email"
          type="email"
          value={email}
          required
          onInput={(e: React.FormEvent<HTMLElement>) =>
            setEmail((e.currentTarget as HTMLInputElement).value)
          }
        />
        <md-outlined-text-field
          label="Password"
          type="password"
          value={password}
          required
          onInput={(e: React.FormEvent<HTMLElement>) =>
            setPassword((e.currentTarget as HTMLInputElement).value)
          }
        />
      </div>

      {error && (
        <p className="text-sm font-medium text-red-200 drop-shadow-sm">
          {error}
        </p>
      )}

      <md-filled-button type="submit" disabled={loading}>
        {loading ? "Logging in..." : "Login"}
      </md-filled-button>
    </form>
  );
}
