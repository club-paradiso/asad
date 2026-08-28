import { DiagnosticsScreen } from "@/features/diagnostics/DiagnosticsScreen";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `진단 · ${BRAND.name}` };

export default function DiagnosticsPage() {
  return <DiagnosticsScreen />;
}
