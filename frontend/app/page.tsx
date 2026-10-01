import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSessionAlive } from "@/lib/session";

export default async function HomePage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("session");

  // Cookie expired/rusak tidak boleh diarahkan ke /lab (itu dulu sumber
  // ping-pong redirect). Hanya sesi hidup yang masuk.
  if (isSessionAlive(session?.value)) {
    redirect("/lab");
  }

  redirect("/login");
}
