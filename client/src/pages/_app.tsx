import type { AppProps } from "next/app";
import App from "../App";
import "../index.css";

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <App>
      <Component {...pageProps} />
    </App>
  );
}
