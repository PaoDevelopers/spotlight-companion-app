import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { FormError, SaveButton } from "./shared";

interface Issued {
  name: string;
  email: string;
  className: string;
  code: string;
}

export default function Roster() {
  const imp = useMutation({ mutationFn: (csv: string) => api.post<{ issued: Issued[] }>("/api/admin/roster", { csv }) });
  return (
    <div className="space-y-3">
      <h1 className="no-print text-2xl font-bold">Roster import</h1>
      <p className="no-print text-muted-foreground">
        Paste CSV with a header row <code>name,email,class</code>. Importing again issues <b>new codes</b> and replaces old ones. Codes are shown once; print them straight away.
        Until Microsoft sign-in is set up, students sign in with email + code.
      </p>
      <form
        className="no-print space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          imp.mutate(String(new FormData(e.currentTarget).get("csv")));
        }}
      >
        <Textarea name="csv" rows={8} required className="font-mono" placeholder={"name,email,class\nAda Lovelace,ada@school.edu,10A"} />
        <SaveButton pending={imp.isPending} pendingText="Importing…">Import &amp; issue codes</SaveButton>
        <FormError error={imp.error} />
      </form>
      {imp.data && imp.data.issued.length > 0 && (
        <div>
          <Button variant="outline" size="sm" className="no-print mb-2" onClick={() => window.print()}>Print codes</Button>
          <table className="w-full text-left text-sm">
            <thead><tr><th>Name</th><th>Class</th><th>Email</th><th>Code</th></tr></thead>
            <tbody>
              {imp.data.issued.map((r) => (
                <tr key={r.email} className="border-t"><td>{r.name}</td><td>{r.className}</td><td>{r.email}</td><td className="font-mono font-bold">{r.code}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
