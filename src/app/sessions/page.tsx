import { SessionsScreen } from "@/features/sessions/SessionsScreen";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `지난 세션 · ${BRAND.name}` };

export default function SessionsPage() {
  return <SessionsScreen />;
}
