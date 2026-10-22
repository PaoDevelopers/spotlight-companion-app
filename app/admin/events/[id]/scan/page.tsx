import { ScanPasses } from "./client";

export default async function Scan({ params }: { params: Promise<{ id: string }> }) {
  return <ScanPasses eventId={Number((await params).id)} />;
}
