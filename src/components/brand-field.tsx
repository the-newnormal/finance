/** Soft teal/lavender wash echoing newnormal.sg's gradient field. */
export function BrandField() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-[20vmax] -top-[25vmax] size-[70vmax] rounded-full bg-[radial-gradient(circle,var(--teal)_0%,rgba(168,213,222,.4)_45%,transparent_70%)] opacity-70 blur-2xl" />
      <div className="absolute -bottom-[30vmax] -right-[20vmax] size-[65vmax] rounded-full bg-[radial-gradient(circle,var(--lavender)_0%,rgba(201,192,234,.4)_45%,transparent_70%)] opacity-70 blur-2xl" />
    </div>
  );
}
