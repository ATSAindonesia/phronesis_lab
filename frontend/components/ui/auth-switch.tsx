"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface AuthSwitchProps {
  defaultMode?: "signin" | "signup";
  onSuccessRedirect?: string;
  className?: string;
}

export const AuthSwitch = ({
  defaultMode = "signin",
  onSuccessRedirect = "/lab",
  className,
}: AuthSwitchProps) => {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">(defaultMode);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sign In Fields
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  // Sign Up Fields
  const [name, setName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);

  const resetMessages = () => {
    setError(null);
    setSuccessMsg(null);
  };

  const handleModeSwitch = (newMode: "signin" | "signup") => {
    resetMessages();
    setMode(newMode);
  };

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Invalid email or password");
        setLoading(false);
        return;
      }

      setSuccessMsg("Signed in successfully! Redirecting...");
      setTimeout(() => {
        router.push(onSuccessRedirect);
        router.refresh();
      }, 600);
    } catch {
      setError("Network error. Please check your connection.");
      setLoading(false);
    }
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    if (!name.trim()) {
      setError("Please enter your full name");
      return;
    }

    if (!signupEmail.trim()) {
      setError("Please enter your email address");
      return;
    }

    if (signupPassword.length < 6) {
      setError("Password must be at least 6 characters long");
      return;
    }

    if (signupPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (!agreeTerms) {
      setError("Please agree to the Terms of Service & Privacy Policy");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: signupEmail.trim(),
          password: signupPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "Registration failed. Please try again.");
        setLoading(false);
        return;
      }

      setSuccessMsg("Account created successfully! Redirecting...");
      setTimeout(() => {
        router.push(onSuccessRedirect);
        router.refresh();
      }, 600);
    } catch {
      setError("Network error. Please check your connection.");
      setLoading(false);
    }
  };

  return (
    <div
      className={cn(
        "relative w-full max-w-md overflow-hidden rounded-3xl border border-white/20 bg-white/10 p-6 sm:p-8 backdrop-blur-2xl shadow-[0_16px_48px_rgba(0,0,0,0.35)] transition-all duration-300",
        className
      )}
    >
      {/* Decorative Glow Elements */}
      <div
        className="pointer-events-none absolute -top-24 -left-24 h-48 w-48 rounded-full bg-blue-500/20 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-24 -right-24 h-48 w-48 rounded-full bg-purple-500/20 blur-3xl"
        aria-hidden="true"
      />

      {/* Header with Unsplash Avatar & Pill Switch */}
      <div className="relative z-10 flex flex-col items-center text-center">
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 p-0.5 shadow-lg shadow-blue-500/30">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="flex -space-x-2 overflow-hidden pl-2">
            <img
              className="inline-block h-6 w-6 rounded-full ring-2 ring-white/40 object-cover"
              src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80"
              alt="Community member"
            />
            <img
              className="inline-block h-6 w-6 rounded-full ring-2 ring-white/40 object-cover"
              src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=100&q=80"
              alt="Community member"
            />
            <img
              className="inline-block h-6 w-6 rounded-full ring-2 ring-white/40 object-cover"
              src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=100&q=80"
              alt="Community member"
            />
          </div>
        </div>

        <h2 className="text-2xl font-bold tracking-tight text-white drop-shadow-sm">
          {mode === "signin" ? "Welcome back" : "Create an account"}
        </h2>
        <p className="mt-1 text-sm text-white/70">
          {mode === "signin"
            ? "Enter your credentials to access your workspace"
            : "Join thousands of builders shipping faster"}
        </p>

        {/* Animated Toggle Pill */}
        <div className="relative mt-6 flex w-full max-w-xs rounded-full bg-black/30 p-1 backdrop-blur-md border border-white/10">
          <div
            className={cn(
              "absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full bg-white/20 shadow-sm backdrop-blur-lg transition-transform duration-300 ease-out",
              mode === "signin" ? "translate-x-0" : "translate-x-full"
            )}
          />
          <button
            type="button"
            onClick={() => handleModeSwitch("signin")}
            className={cn(
              "relative z-10 w-1/2 py-2 text-xs font-semibold tracking-wide transition-colors duration-200",
              mode === "signin" ? "text-white" : "text-white/60 hover:text-white"
            )}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch("signup")}
            className={cn(
              "relative z-10 w-1/2 py-2 text-xs font-semibold tracking-wide transition-colors duration-200",
              mode === "signup" ? "text-white" : "text-white/60 hover:text-white"
            )}
          >
            Sign Up
          </button>
        </div>
      </div>

      {/* Social Buttons */}
      <div className="relative z-10 mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setError("Social login is coming soon")}
          className="flex h-10 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 text-xs font-medium text-white/90 backdrop-blur-md transition-all duration-200 hover:bg-white/15 hover:border-white/30 active:scale-[0.98]"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24">
            <path
              fill="#EA4335"
              d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"
            />
            <path
              fill="#4285F4"
              d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5.1 3.7-8.8z"
            />
            <path
              fill="#FBBC05"
              d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3 0-.8.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z"
            />
            <path
              fill="#34A853"
              d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z"
            />
          </svg>
          Google
        </button>

        <button
          type="button"
          onClick={() => setError("GitHub login is coming soon")}
          className="flex h-10 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 text-xs font-medium text-white/90 backdrop-blur-md transition-all duration-200 hover:bg-white/15 hover:border-white/30 active:scale-[0.98]"
        >
          <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          GitHub
        </button>
      </div>

      {/* Divider */}
      <div className="relative z-10 my-5 flex items-center">
        <div className="w-full border-t border-white/10" />
        <span className="shrink-0 px-3 text-[11px] font-medium tracking-wider uppercase text-white/50">
          Or continue with
        </span>
        <div className="w-full border-t border-white/10" />
      </div>

      {/* Status Messages */}
      {error && (
        <div className="relative z-10 mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-center text-xs font-medium text-rose-200 backdrop-blur-md animate-in fade-in slide-in-from-top-1">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="relative z-10 mb-4 flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center text-xs font-medium text-emerald-200 backdrop-blur-md animate-in fade-in slide-in-from-top-1">
          <CheckCircle2 className="h-4 w-4" />
          {successMsg}
        </div>
      )}

      {/* Forms Container with Transition */}
      <div className="relative z-10">
        {mode === "signin" ? (
          /* Sign In Form */
          <form onSubmit={handleSignInSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/80">
                Email Address
              </label>
              <div className="relative flex items-center">
                <Mail className="pointer-events-none absolute left-3.5 h-4 w-4 text-white/50" />
                <input
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="h-11 w-full rounded-xl border border-white/15 bg-white/5 pl-10 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400/40 transition-all"
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-white/80">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setError("Password reset link will be sent to your email")}
                  className="text-xs text-blue-300 hover:text-blue-200 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative flex items-center">
                <Lock className="pointer-events-none absolute left-3.5 h-4 w-4 text-white/50" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="h-11 w-full rounded-xl border border-white/15 bg-white/5 pl-10 pr-10 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400/40 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 text-white/50 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="rememberMe"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-white/10 text-blue-500 focus:ring-blue-400/30"
              />
              <label htmlFor="rememberMe" className="text-xs text-white/70">
                Remember me for 30 days
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 font-medium text-sm text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-600 hover:to-indigo-700 hover:shadow-blue-500/35 active:scale-[0.98] disabled:opacity-60 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing In...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        ) : (
          /* Sign Up Form */
          <form onSubmit={handleSignUpSubmit} className="flex flex-col gap-3.5">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/80">
                Full Name
              </label>
              <div className="relative flex items-center">
                <User className="pointer-events-none absolute left-3.5 h-4 w-4 text-white/50" />
                <input
                  type="text"
                  required
                  placeholder="Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-10 w-full rounded-xl border border-white/15 bg-white/5 pl-10 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400/40 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-white/80">
                Email Address
              </label>
              <div className="relative flex items-center">
                <Mail className="pointer-events-none absolute left-3.5 h-4 w-4 text-white/50" />
                <input
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  className="h-10 w-full rounded-xl border border-white/15 bg-white/5 pl-10 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400/40 transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="mb-1 block text-xs font-medium text-white/80">
                  Password
                </label>
                <div className="relative flex items-center">
                  <Lock className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-white/50" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="••••••••"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    className="h-10 w-full rounded-xl border border-white/15 bg-white/5 pl-8 pr-3 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400/40 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-white/80">
                  Confirm
                </label>
                <div className="relative flex items-center">
                  <Lock className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-white/50" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-10 w-full rounded-xl border border-white/15 bg-white/5 pl-8 pr-3 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400/40 transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-1">
              <input
                id="agreeTerms"
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-white/10 text-blue-500 focus:ring-blue-400/30"
              />
              <label htmlFor="agreeTerms" className="text-xs text-white/70 leading-tight">
                I agree to the{" "}
                <span className="text-blue-300 hover:underline cursor-pointer">Terms</span> and{" "}
                <span className="text-blue-300 hover:underline cursor-pointer">Privacy Policy</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 font-medium text-sm text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-600 hover:to-indigo-700 hover:shadow-blue-500/35 active:scale-[0.98] disabled:opacity-60 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating Account...
                </>
              ) : (
                <>
                  Create Account
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Footer Switch Prompt */}
      <div className="relative z-10 mt-6 text-center text-xs text-white/60">
        {mode === "signin" ? (
          <>
            Don&apos;t have an account yet?{" "}
            <button
              type="button"
              onClick={() => handleModeSwitch("signup")}
              className="font-semibold text-blue-300 hover:text-blue-200 transition-colors"
            >
              Create an account
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => handleModeSwitch("signin")}
              className="font-semibold text-blue-300 hover:text-blue-200 transition-colors"
            >
              Sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export const Component = AuthSwitch;
export default AuthSwitch;
