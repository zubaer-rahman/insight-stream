import { ImageResponse } from "next/og";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090b",
        }}
      >
        <svg viewBox="0 0 64 64" width="56" height="56">
          <defs>
            <linearGradient id="icon-gradient" x1="8" y1="8" x2="56" y2="56">
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
            stroke="url(#icon-gradient)"
            strokeWidth="3.5"
          />
          <path
            d="M41 18 C33 18 27 22 27 27 C27 31 30 34 37 36 C42 37 45 39 45 42 C45 46 40 48 33 48 C27 48 22 46 19 43"
            fill="none"
            stroke="url(#icon-gradient)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="5"
          />
        </svg>
      </div>
    ),
    {
      ...size,
    },
  );
}
