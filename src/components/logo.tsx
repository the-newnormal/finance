import Image from "next/image";

export function Logo({ size = 32, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {/* Decorative beside the visible name; on its own it is the name. */}
      <Image src="/logo.svg" alt={withText ? "" : "New Normal Finance"} width={size} height={size} priority />
      {withText && (
        <span className="leading-none">
          <span className="block font-serif text-lg font-semibold">New Normal</span>
          <span className="block text-[11px] uppercase tracking-[0.14em] text-ink-soft">Finance</span>
        </span>
      )}
    </span>
  );
}
