import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("session");

  if (session?.value) {
    redirect("/lab");
  }

  redirect("/login");
}
