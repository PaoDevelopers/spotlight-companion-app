import { RosterForm } from "./form";

export default function Roster() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Roster import</h1>
      <p className="text-slate-600">Paste CSV with a header row <code>name,email,class</code>. Importing again issues <b>new codes</b> and replaces old ones. Codes are shown once; print them straight away. Until Microsoft SSO is set up, students sign in with email + code.</p>
      <RosterForm />
    </div>
  );
}
