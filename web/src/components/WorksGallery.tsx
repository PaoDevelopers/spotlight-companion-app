import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PhotoAdder } from "@/components/PhotoAdder";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Work } from "@/lib/types";

/** Pictures students share from an event: paintings, a taken-apart computer, a finished model. Checked-in students can add theirs. */
export function WorksGallery({ eventId, checkedIn }: { eventId: number; checkedIn: boolean }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const key = ["works", eventId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ works: Work[]; canPost: boolean }>(`/api/events/${eventId}/works`) });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/api/works/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const works = q.data?.works ?? [];
  const staff = me && me.role !== "student";
  if (!q.data || (works.length === 0 && !checkedIn)) return null;
  return (
    <section aria-label="Shared works" className="space-y-3">
      <h2 className="mt-2 text-lg font-semibold">Works shared from this event</h2>
      {works.length === 0 && <p className="rounded-lg bg-card p-3 text-sm text-muted-foreground shadow-sm">Nobody has shared anything yet. Be the first!</p>}
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {works.map((w) => (
          <li key={w.id} className="overflow-hidden rounded-lg bg-card text-sm shadow-sm">
            <img src={w.imageUrl} alt={w.caption || `Shared by ${w.name}`} loading="lazy" className="aspect-square w-full object-cover" />
            <div className="p-2">
              {w.caption && <p className="break-words">{w.caption}</p>}
              <p className="text-xs text-muted-foreground">{w.name}{w.className ? ` · ${w.className}` : ""}</p>
              {(w.userId === me?.id || staff) && (
                <button type="button" className="text-xs text-red-700 underline" onClick={() => { if (window.confirm("Remove this picture?")) del.mutate(w.id); }}>Remove</button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {del.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(del.error)}</p>}
      {q.data.canPost && (
        <PhotoAdder kind="work" label="Share a picture of your work" attach={(imageId, caption) => api.post(`/api/events/${eventId}/works`, { imageId, caption })} onDone={() => qc.invalidateQueries({ queryKey: key })} />
      )}
    </section>
  );
}
