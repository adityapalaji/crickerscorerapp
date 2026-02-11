declare module "@radix-ui/*";
declare module "embla-carousel-react";
declare module "recharts";
declare module "some-untyped-package"; // add any other modules TS complains about

declare module "react-resizable-panels" {
  import type { ComponentType } from "react";

  export const PanelGroup: ComponentType<any>;
  export const Panel: ComponentType<any>;
  export const PanelResizeHandle: ComponentType<any>;
}
