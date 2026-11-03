import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SubjectBadge } from "@/components/ui/badge";
import { QrImage } from "@/components/QrImage";
import { CoverThumb } from "@/components/CoverThumb";
import { api } from "@/lib/api";
import type { Exhibit } from "@/lib/types";
import { useAdminExhibitions } from "./ExhibitEditor";
import { FormError, panel } from "./shared";

export type AdminExhibit = Exhibit & { tagToken: string; tagUrl: string; visits: number };

export const useAdminExhibits = () => useQuery({ queryKey: ["admin-exhibits"], queryFn: () => api.get<AdminExhibit[]>("/api/admin/exhibits") });


function ExhibitRow({ x }: { x: AdminExhibit }) {
  return (
    <Link to={`/admin/exhibits/${x.id}`} className="flex items-center gap-3 rounded-lg bg-card p-3 shadow-sm hover:bg-accent">
      <CoverThumb imageUrl={x.imageUrl} markdown={x.bodyMd} className="size-12" />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          <SubjectBadge subject={x.subject} />
          <b>{x.title}</b>
        </div>
        <div className="truncate text-sm text-muted-foreground">{x.summary || "No summary yet"}</div>
      </div>
      <div className="text-right text-sm text-muted-foreground">
        {x.visits} {x.visits === 1 ? "visit" : "visits"}
      </div>
    </Link>
  );
}

export default function AdminExhibits() {
  const q = useAdminExhibits();
  const groups = useAdminExhibitions();
  const exhibits = q.data ?? [];
  const inGroup = (id: number) => exhibits.filter((x) => x.exhibitionId === id);
  const loose = exhibits.filter((x) => x.exhibitionId === null || !groups.data?.some((g) => g.id === x.exhibitionId));
  const hasGroups = (groups.data?.length ?? 0) > 0;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Exhibits</h1>
        <span className="flex gap-2">
          <Button asChild variant="outline"><Link to="/admin/exhibitions/new">New exhibition</Link></Button>
          <Button asChild><Link to="/admin/exhibits/new">New exhibit</Link></Button>
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        An <b>exhibit</b> is one installation with its own QR code. An <b>exhibition</b> groups exhibits that belong together, such as a Physics Exhibition and a Chemistry Exhibition.
        {!hasGroups && " You don't need an exhibition: you can also add exhibits on their own."}
      </p>
      {q.data && exhibits.length === 0 && !hasGroups && <p className="text-muted-foreground">Nothing here yet. Add the first exhibit, or create an exhibition to group several.</p>}
      {groups.data?.map((g) => (
        <section key={g.id} className="space-y-2" aria-label={g.title}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-1">
            <h2 className="text-lg font-semibold">
              <SubjectBadge subject={g.subject} />
              {g.title} <span className="text-sm font-normal text-muted-foreground">({g.total})</span>
            </h2>
            <span className="flex gap-3 text-sm">
              <Link to={`/admin/exhibits/new?exhibition=${g.id}`} className="underline">Add an exhibit here</Link>
              <Link to={`/admin/exhibitions/${g.id}/edit`} className="underline">Edit exhibition</Link>
            </span>
          </div>
          {g.summary && <p className="text-sm text-muted-foreground">{g.summary}</p>}
          <div className="grid gap-2 lg:grid-cols-2">{inGroup(g.id).map((x) => <ExhibitRow key={x.id} x={x} />)}</div>
          {inGroup(g.id).length === 0 && <p className="text-sm text-muted-foreground">No exhibits in it yet.</p>}
        </section>
      ))}
      {loose.length > 0 && (
        <section className="space-y-2" aria-label="Not in an exhibition">
          {hasGroups && <h2 className="border-b pb-1 text-lg font-semibold">Not in an exhibition <span className="text-sm font-normal text-muted-foreground">({loose.length})</span></h2>}
          <div className="grid gap-2 lg:grid-cols-2">{loose.map((x) => <ExhibitRow key={x.id} x={x} />)}</div>
        </section>
      )}
    </div>
  );
}

/** One exhibit: its QR/NFC tag for the installation, how many students visited, and edit / delete. */
export function AdminExhibitDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useAdminExhibits();
  const groups = useAdminExhibitions();
  const del = useMutation({
    mutationFn: () => api.del(`/api/admin/exhibits/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-exhibits"] });
      qc.invalidateQueries({ queryKey: ["exhibits"] });
      navigate("/admin/exhibits", { replace: true });
    },
  });
  if (!q.data) return null;
  const x = q.data.find((e) => String(e.id) === id);
  if (!x) return <p>Exhibit not found.</p>;
  const group = groups.data?.find((g) => g.id === x.exhibitionId);
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        {x.imageUrl && <img src={x.imageUrl} alt="" className="h-40 w-full rounded-lg object-cover md:h-56" />}
        <div>
          <SubjectBadge subject={x.subject} />
          <h1 className="inline text-2xl font-bold">{x.title}</h1>
        </div>
        {group && <p className="text-sm">Part of <Link to={`/admin/exhibitions/${group.id}/edit`} className="underline">{group.title}</Link></p>}
        {x.summary && <p className="text-muted-foreground">{x.summary}</p>}
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link to={`/admin/exhibits/${x.id}/edit`}>Edit exhibit</Link></Button>
          <Button asChild variant="outline"><Link to={`/admin/exhibits/${x.id}/sign`}>Print QR sign</Link></Button>
          <Button asChild variant="outline"><Link to={`/exhibits/${x.slug}`}>See it as a student</Link></Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="rounded-lg bg-card p-4 text-center shadow-sm">
          <div className="text-3xl font-bold">{x.visits}</div>
          <div className="text-sm text-muted-foreground">{x.visits === 1 ? "student has" : "students have"} scanned this exhibit</div>
        </div>
        <section className={panel}>
          <h2 className="font-semibold">QR code / NFC tag for the installation</h2>
          <p className="mb-2 text-sm text-muted-foreground">
            Print the sign and put it at the installation, or write this address to an NFC tag. It never changes when you edit the exhibit, so a printed sign stays valid.
          </p>
          <code className="block break-all text-xs">{x.tagUrl}</code>
          <div className="mt-2"><QrImage text={x.tagUrl} size={160} /></div>
        </section>
      </div>

      <FormError error={del.error} />
      <button
        className="text-red-700 underline"
        disabled={del.isPending}
        onClick={() => { if (window.confirm(`Delete “${x.title}”? Its printed QR code will stop working and the ${x.visits} recorded visits are forgotten.`)) del.mutate(); }}
      >
        Delete exhibit
      </button>
    </div>
  );
}

/** A sign to print and put next to the installation: the QR code, big, with the name and what to do. */
export function AdminExhibitSign() {
  const { id } = useParams();
  const q = useAdminExhibits();
  if (!q.data) return null;
  const x = q.data.find((e) => String(e.id) === id);
  if (!x) return <p>Exhibit not found.</p>;
  return (
    <div className="space-y-4">
      <div className="no-print flex gap-2">
        <Button onClick={() => window.print()}>Print</Button>
        <Button asChild variant="outline"><Link to={`/admin/exhibits/${x.id}`}>Back</Link></Button>
      </div>
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-lg border-2 border-foreground bg-white p-8 text-center text-black print:border-0">
        <h1 className="text-4xl font-bold">{x.title}</h1>
        {x.summary && <p className="text-xl">{x.summary}</p>}
        <QrImage text={x.tagUrl} size={340} />
        <p className="text-2xl font-semibold">Scan to learn about this exhibit and log your visit</p>
        <p className="text-base">Spotlight Month app: tap “Scan”, or use your phone's camera. No phone? Tell a teacher.</p>
      </div>
    </div>
  );
}
