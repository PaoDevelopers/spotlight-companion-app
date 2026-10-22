import { ScanClient } from "./client";

export default function Scan() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Scan to check in</h1>
      <p className="text-slate-600">Point the camera at the event screen or an exhibit code.</p>
      <ScanClient />
    </div>
  );
}
