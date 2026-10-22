"use client";
import { useActionState } from "react";
import { importRosterAction } from "../actions";

export function RosterForm() {
  const [state, action, pending] = useActionState(importRosterAction, null);
  return (
    <>
      <form action={action} className="space-y-2 print:hidden">
        <textarea name="csv" rows={8} required className="w-full rounded border p-2 font-mono text-sm" placeholder={"name,email,class\nAda Lovelace,ada@school.edu,10A"} />
        <button disabled={pending} className="rounded bg-slate-900 px-4 py-2 text-white">Import &amp; issue codes</button>
        {state?.error && <p role="alert" className="text-red-700">{state.error}</p>}
      </form>
      {state && state.issued.length > 0 && (
        <div>
          <button onClick={() => window.print()} className="mb-2 rounded border px-3 py-1 print:hidden">Print codes</button>
          <table className="w-full text-left text-sm"><thead><tr><th>Name</th><th>Class</th><th>Email</th><th>Code</th></tr></thead>
            <tbody>{state.issued.map((r) => <tr key={r.email} className="border-t"><td>{r.name}</td><td>{r.className}</td><td>{r.email}</td><td className="font-mono font-bold">{r.code}</td></tr>)}</tbody></table>
        </div>
      )}
    </>
  );
}
