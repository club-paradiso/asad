import { BoothPreflightScreen } from "@/features/live/BoothPreflightScreen";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `Booth preflight · ${BRAND.name}`,
  description: "Local-only church interpretation booth audio input check for ASAD Sermon Mode.",
};

export default function BoothPreflightPage() {
  return <BoothPreflightScreen />;
}
