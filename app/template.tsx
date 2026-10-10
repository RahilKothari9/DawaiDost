import type { ReactNode } from "react";
import { PageTransition } from "@/components/shell/PageTransition";

export default function Template({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
