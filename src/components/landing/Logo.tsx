import Link from "next/link";

// The `{char}` wordmark. Braces sit a touch lighter so the word reads first.
export default function Logo({ className = "", href = "/" }: { className?: string; href?: string | null }) {
  const mark = (
    <span className={`char-logo font-mono font-extrabold tracking-[-0.06em] ${className}`}>
      <span className="char-brace">{"{"}</span>char<span className="char-brace">{"}"}</span>
    </span>
  );
  if (!href) return mark;
  return (
    <Link href={href} aria-label="char home" className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4">
      {mark}
    </Link>
  );
}
