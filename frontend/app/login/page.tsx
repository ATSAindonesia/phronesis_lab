import { AuthSwitch } from "@/components/ui/auth-switch";

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden px-4 py-8">
      {/* Video background */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
      >
        <source src="/video/14239051_1920_1080_25fps.mp4" type="video/mp4" />
      </video>

      {/* Dark overlay blur */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Modern Auth Switch component */}
      <div className="relative z-10 w-full flex justify-center">
        <AuthSwitch defaultMode="signin" onSuccessRedirect="/lab" />
      </div>
    </main>
  );
}
