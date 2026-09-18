"use client";

export function BackgroundWaveform() {
  const pathD =
    "M 0,60 " +
    // Cycle 1
    "L 50,60 L 65,60 Q 76,46 88,60 L 110,60 L 122,76 L 135,10 L 148,110 L 158,60 L 180,60 Q 196,36 214,60 L 400,60 " +
    // Cycle 2
    "L 450,60 L 465,60 Q 476,46 488,60 L 510,60 L 522,76 L 535,10 L 548,110 L 558,60 L 580,60 Q 596,36 614,60 L 800,60 " +
    // Cycle 3
    "L 850,60 L 865,60 Q 876,46 888,60 L 910,60 L 922,76 L 935,10 L 948,110 L 958,60 L 980,60 Q 996,36 1014,60 L 1200,60 " +
    // Cycle 4
    "L 1250,60 L 1265,60 Q 1276,46 1288,60 L 1310,60 L 1322,76 L 1335,10 L 1348,110 L 1358,60 L 1380,60 Q 1396,36 1414,60 L 1600,60";

  return (
    <div
      className="fixed inset-0 pointer-events-none -z-10 overflow-hidden select-none"
      aria-hidden="true"
    >
      {/* Millimeter clinical chart grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.045]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(122,46,46,0.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(122,46,46,0.5) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      {/* Primary Top Telemetry Stream (Lead II, Ch-A) - Visible across hero & top section */}
      <div className="absolute top-16 md:top-20 left-0 right-0 w-full opacity-[0.24]">
        <div className="mx-auto max-w-6xl px-6 mb-1.5 flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-primary">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 bg-primary inline-block animate-status-pulse" />
            <span className="font-semibold">TELEMETRY // LEAD II (CH-A)</span>
          </div>
          <span className="text-muted-foreground font-medium">250 HZ // ACTIVE MONITORING</span>
        </div>

        <div className="w-full overflow-hidden">
          <svg
            viewBox="0 0 1600 120"
            preserveAspectRatio="none"
            className="w-full h-24 sm:h-32 md:h-36 stroke-primary fill-none overflow-visible"
          >
            {/* Baseline faint trace */}
            <path
              d={pathD}
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="opacity-45"
            />
            {/* Active sweep pulse trace */}
            <path
              d={pathD}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="240 1360"
              className="opacity-95"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="1600"
                to="0"
                dur="6s"
                repeatCount="indefinite"
              />
            </path>
            {/* Traveling Pulse Beacon with radar ping */}
            <g>
              <circle r="7" className="stroke-primary fill-none" strokeWidth="1">
                <animateMotion path={pathD} dur="6s" repeatCount="indefinite" />
                <animate attributeName="r" values="3;9;3" dur="1s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.9;0.15;0.9" dur="1s" repeatCount="indefinite" />
              </circle>
              <circle r="3.5" className="fill-primary">
                <animateMotion path={pathD} dur="6s" repeatCount="indefinite" />
              </circle>
            </g>
          </svg>
        </div>
      </div>

      {/* Mid-Page Telemetry Stream (Lead V1, Ch-B) - Visible across mid section */}
      <div className="absolute top-[48%] left-0 right-0 w-full opacity-[0.16] hidden sm:block">
        <div className="mx-auto max-w-6xl px-6 mb-1 flex items-center justify-between font-mono text-[8px] uppercase tracking-widest text-primary/80">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 bg-primary/70 inline-block" />
            <span>TELEMETRY // LEAD V1 (CH-B)</span>
          </div>
          <span className="text-muted-foreground">PACING NOMINAL</span>
        </div>

        <div className="w-full overflow-hidden">
          <svg
            viewBox="0 0 1600 120"
            preserveAspectRatio="none"
            className="w-full h-24 stroke-primary fill-none overflow-visible"
          >
            <path
              d={pathD}
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="opacity-35"
            />
            <path
              d={pathD}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="200 1400"
              className="opacity-90"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="1600"
                to="0"
                dur="7.5s"
                begin="1s"
                repeatCount="indefinite"
              />
            </path>
            <g>
              <circle r="3" className="fill-primary">
                <animateMotion path={pathD} dur="7.5s" begin="1s" repeatCount="indefinite" />
              </circle>
            </g>
          </svg>
        </div>
      </div>

      {/* Lower Telemetry Stream (Lead V5, Ch-C) - Visible above footer */}
      <div className="absolute bottom-12 md:bottom-16 left-0 right-0 w-full opacity-[0.18]">
        <div className="mx-auto max-w-6xl px-6 mb-1 flex items-center justify-between font-mono text-[8px] uppercase tracking-widest text-primary/80">
          <span>TELEMETRY // LEAD V5 (CH-C)</span>
          <span className="text-muted-foreground">CONTINUOUS AUDIT LOG</span>
        </div>
        <div className="w-full overflow-hidden">
          <svg
            viewBox="0 0 1600 120"
            preserveAspectRatio="none"
            className="w-full h-24 stroke-primary fill-none overflow-visible"
          >
            <path
              d={pathD}
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="opacity-40"
            />
            <path
              d={pathD}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="220 1380"
              className="opacity-90"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="1600"
                to="0"
                dur="9s"
                begin="2s"
                repeatCount="indefinite"
              />
            </path>
            <g>
              <circle r="3" className="fill-primary">
                <animateMotion path={pathD} dur="9s" begin="2s" repeatCount="indefinite" />
              </circle>
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
