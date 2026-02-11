import React from "react";
import dynamic from "next/dynamic";

const AppRoot = dynamic(() => import("../App"), { ssr: false });

export default function Home() {
  return <AppRoot />;
}
