import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { fetchSessionFromHeaders } from "@/lib/server-session";

import LoginClient from "./login-client";

export default async function LoginPage() {
  const incomingHeaders = await headers();
  const session = await fetchSessionFromHeaders(incomingHeaders, "login");

  // Already signed in → straight to the dashboard so we don't get stuck in
  // a "succeed-then-bounce-back-to-login" loop after sign-up.
  if (session?.user) {
    redirect("/dashboard");
  }

  return <LoginClient />;
}
