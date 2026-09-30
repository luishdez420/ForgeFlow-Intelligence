import { redirect } from "next/navigation";

import { auth } from "../auth";
import { AnalystConsole } from "./analyst-console";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/sign-in");
  }
  return <AnalystConsole analystEmail={session.user.email} />;
}
