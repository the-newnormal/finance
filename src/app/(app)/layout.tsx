import { BrandField } from "@/components/brand-field";
import { Nav } from "@/components/nav";
import { requireMember } from "@/lib/session";
import { canReview, isFinance, ROLE_LABEL } from "@/lib/types";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireMember();
  const links = [
    { href: "/claims", label: "My claims" },
    ...(canReview(me) ? [{ href: "/review", label: "Review" }, { href: "/budgets", label: "Budgets" }] : []),
    ...(isFinance(me)
      ? [
          { href: "/payouts", label: "Payouts" },
          { href: "/bank", label: "Bank" },
          { href: "/people", label: "People" },
          { href: "/setup", label: "Setup" },
        ]
      : []),
  ];
  const roleLabel = ROLE_LABEL[me.role];

  return (
    <div className="relative min-h-dvh">
      <BrandField />
      <Nav links={links} name={me.name} roleLabel={roleLabel} />
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">{children}</main>
    </div>
  );
}
