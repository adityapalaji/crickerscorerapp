import type { AppProps } from "next/app";
import "../src/index.css"; // adjust if your css file is at a different path

export default function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
