import { PrepScreen } from "@/features/prep/PrepScreen";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `준비 시트 · ${BRAND.name}` };

export default function PrepPage() {
  return <PrepScreen />;
}
