import type { Metadata } from "next";
import { StockView } from "@/components/views/StockView";

export const metadata: Metadata = { title: "Stock and forecast", description: "Days of stock for every clinic and medicine." };

export default function Page() {
  return <StockView />;
}
