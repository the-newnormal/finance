"use client";

import { LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Nav({ links, name, roleLabel }: { links: { href: string; label: string }[]; name: string; roleLabel: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const linkEls = links.map((l) => {
    const active = pathname === l.href || pathname.startsWith(l.href + "/");
    return (
      <Link key={l.href} href={l.href} onClick={() => setOpen(false)}
        className={cn("rounded-full px-3.5 py-1.5 text-sm transition-colors", active ? "bg-ink text-white" : "text-ink-soft hover:bg-ink/5 hover:text-ink")}>
        {l.label}
      </Link>
    );
  });

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/claims" aria-label="Home"><Logo size={30} /></Link>
        <nav className="ml-4 hidden items-center gap-1 md:flex">{linkEls}</nav>
        <div className="ml-auto hidden items-center gap-3 md:flex">
          <div className="text-right leading-tight">
            <div className="text-sm font-medium">{name}</div>
            <div className="text-xs text-ink-soft">{roleLabel}</div>
          </div>
          <SignOut><Button type="submit" variant="ghost" size="icon" aria-label="Sign out"><LogOut /></Button></SignOut>
        </div>
        <Button variant="ghost" size="icon" className="ml-auto md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
          {open ? <X /> : <Menu />}
        </Button>
      </div>
      {open && (
        <div className="border-t border-line px-4 pb-4 md:hidden">
          <nav className="flex flex-col gap-1 pt-3">{linkEls}</nav>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <div className="text-sm"><div className="font-medium">{name}</div><div className="text-xs text-ink-soft">{roleLabel}</div></div>
            <SignOut><Button type="submit" variant="outline" size="sm"><LogOut /> Sign out</Button></SignOut>
          </div>
        </div>
      )}
    </header>
  );
}

// A plain form POST: signing out works without JavaScript and can't be triggered by a link.
function SignOut({ children }: { children: React.ReactNode }) {
  return <form action="/auth/signout" method="post">{children}</form>;
}
