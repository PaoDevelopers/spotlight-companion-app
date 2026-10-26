import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { FormError, SaveButton } from "./shared";

export default function Dashboard() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ["admin-stats"], queryFn: () => api.get<{ events: number; checkins: number; users: number; exhibits: number }>("/api/admin/stats") });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("teacher");
  const set = useMutation({ mutationFn: () => api.post("/api/admin/users/role", { email, role }) });
  const s = q.data;
  return (
    <div className="space-y-6">
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [["Events", s.events], ["Check-ins", s.checkins], ["Users", s.users], ["Exhibits", s.exhibits]] as const
          ).map(([l, n]) => (
            <Card key={l} className="p-4 text-center">
              <div className="text-3xl font-bold">{n}</div>
              {l}
            </Card>
          ))}
        </div>
      )}
      {me?.role === "admin" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            set.mutate();
          }}
          className="flex flex-wrap gap-2 rounded-lg bg-card p-4 shadow-sm"
        >
          <b className="w-full">Set a user&apos;s role</b>
          <Input name="email" type="email" placeholder="user email" required className="w-auto" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select name="role" className="w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
            <option>student</option>
            <option>teacher</option>
            <option>admin</option>
          </Select>
          <SaveButton pending={set.isPending}>Save</SaveButton>
          {set.isSuccess && <span className="self-center text-sm text-emerald-700">Saved</span>}
          <FormError error={set.error} />
        </form>
      )}
    </div>
  );
}
