import React from "react";
import dynamic from "next/dynamic";

// Import home page with SSR disabled (renders on client only)
const HomeLanding = dynamic(() => import("./home"), { ssr: false });

export default function Home() {
  return <HomeLanding />;
}
