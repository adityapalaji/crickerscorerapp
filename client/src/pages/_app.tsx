import type { AppProps } from "next/app";
import { useEffect } from "react";
import App from "../App";
import "../index.css";

export default function MyApp({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // No-op: app remains usable without offline cache.
      });
    }
  }, []);

  return (
    <App>
      <Component {...pageProps} />
    </App>
  );
}
