import { DisplayClient } from "./client";

export default async function Display({ params }: { params: Promise<{ id: string }> }) {
  return <DisplayClient eventId={Number((await params).id)} />;
}
