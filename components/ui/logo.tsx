import type { SVGProps } from "react";

type LogoProps = Readonly<
  SVGProps<SVGSVGElement> & {
    title?: string;
  }
>;

export function Logo({
  title = "Insight Stream",
  className,
  ...props
}: LogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      className={className}
      {...props}
    >
      <defs>
        <linearGradient id="insight-stream-gradient" x1="8" y1="8" x2="56" y2="56">
          <stop offset="0%" stopColor="#a1a1aa" />
          <stop offset="100%" stopColor="#f4f4f5" />
        </linearGradient>
      </defs>
      <rect
        x="8"
        y="8"
        width="48"
        height="48"
        rx="12"
        fill="none"
        stroke="url(#insight-stream-gradient)"
        strokeWidth="3.5"
      />
      <path
        d="M21 23 L33 32 L21 41"
        fill="none"
        stroke="url(#insight-stream-gradient)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="4.5"
      />
      <path
        d="M43 23 L31 32 L43 41"
        fill="none"
        stroke="url(#insight-stream-gradient)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="4.5"
      />
    </svg>
  );
}
