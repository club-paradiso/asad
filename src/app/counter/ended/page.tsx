import { CounterEndedScreen } from "@/features/counter/CounterEndedScreen";

export default async function CounterEndedPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const params = await searchParams;
  return <CounterEndedScreen lang={params.lang} />;
}
