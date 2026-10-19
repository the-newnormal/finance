import { redirect } from "next/navigation";

// Signed-in people land on their claims; the proxy sends everyone else to sign in.
export default function Home() {
  redirect("/claims");
}
