import Image from "next/image";

export function Logo({ size = 32, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Image src="/logo.svg" alt="" width={size} height={size} priority />
      {withText && (
        <span className="leading-none">
          <span className="block font-serif text-lg font-semibold">New Normal</span>
          <span className="block text-[11px] uppercase tracking-[0.14em] text-ink-soft">Finance</span>
        </span>
      )}
    </span>
  );
}
