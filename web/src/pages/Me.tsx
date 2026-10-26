import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QrImage } from "@/components/QrImage";
import { api } from "@/lib/api";
import { signOutCleanup, useAuth } from "@/lib/auth";

export default function Me() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const hist = useQuery({ queryKey: ["my-checkins"], queryFn: () => api.get<{ event: string; method: string; at: string }[]>("/api/me/checkins") });
  const [show, setShow] = useState<boolean | null>(null);
  const save = useMutation({
    mutationFn: (v: boolean) => api.patch("/api/me", { showOnLeaderboard: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  if (!me) return null;
  const checked = show ?? me.showOnLeaderboard;

  async function signOut() {
    signOutCleanup();
    await api.post("/api/auth/logout");
    qc.clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{me.name}</h1>
      <Card className="p-4 text-center">
        <p className="mb-2 text-sm text-muted-foreground">My pass: show this to a teacher if scanning doesn&apos;t work</p>
        <div className="flex justify-center">
          <QrImage text={me.passToken} size={200} />
        </div>
      </Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(checked);
        }}
        className="flex items-center gap-2 rounded-lg bg-card p-3 shadow-sm"
      >
        <input id="show" type="checkbox" checked={checked} onChange={(e) => {
            setShow(e.target.checked);
            save.reset();
          }} />
        <label htmlFor="show" className="flex-1">
          Show my name on public leaderboards
        </label>
        <Button variant="outline" size="sm">
          {save.isSuccess ? "Saved" : "Save"}
        </Button>
      </form>
      <section>
        <h2 className="mb-2 font-semibold">My check-ins</h2>
        {hist.data?.map((h, i) => (
          <div key={i} className="mb-1 rounded bg-card p-2 text-sm shadow-sm">
            {h.event} <span className="text-muted-foreground">· {h.method}</span>
          </div>
        ))}
        {hist.data?.length === 0 && <p className="text-muted-foreground">None yet.</p>}
      </section>
      <button onClick={signOut} className="underline">
        Sign out
      </button>
    </div>
  );
}
