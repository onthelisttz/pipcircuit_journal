import type { Metadata } from "next";
import { ObservationsPage } from "@ui/features/observations";

export const metadata: Metadata = {
  title: "Observations",
};

export default function ObservationsRoute() {
  return <ObservationsPage />;
}
