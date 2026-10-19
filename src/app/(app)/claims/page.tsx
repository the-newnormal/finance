import { PageHeader } from "@/components/page-header";
import { requireMember } from "@/lib/session";

export const metadata = { title: "My claims" };

export default async function MyClaimsPage() {
  const me = await requireMember();
  return <PageHeader title={`Hi, ${me.name.split(" ")[0]}`} description="Claims arrive in the next update." />;
}
