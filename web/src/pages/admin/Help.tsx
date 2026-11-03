import type { ReactNode } from "react";
import { Link } from "react-router-dom";

function Topic({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="rounded-lg bg-card p-4 shadow-sm">
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <div className="mt-2 space-y-2 text-sm [&_li]:ml-5 [&_li]:list-disc [&_ol>li]:list-decimal">{children}</div>
    </details>
  );
}

/** A short guide in plain words, for a teacher who has never used the portal. */
export default function Help() {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <h1 className="text-2xl font-bold">How it works</h1>
      <p className="text-sm text-muted-foreground">Everything here is also explained where you use it. Open a topic below for the short version.</p>

      <Topic title="Getting ready (before the month)" open>
        <ol>
          <li>Ask an <b>admin</b> to load the school's student list (on the Teacher portal page). Then you can find any student by name, even before they have signed in.</li>
          <li>Add the <b>exhibits</b>. Group them into <b>exhibitions</b> if you like (for example a Physics Exhibition and a Chemistry Exhibition). Each exhibit gets its own page and QR code.</li>
          <li>For each exhibit, open it and press <b>Print QR sign</b>. Put the sign next to the installation. Students scan it to read about it and log their visit.</li>
          <li>Add the <b>events</b>.</li>
        </ol>
      </Topic>

      <Topic title="Creating an event">
        <ol>
          <li>Press <Link to="/admin/events/new" className="underline">New event</Link>. Give it a title, a subject, a start time and a place.</li>
          <li>Write what students should know in <b>About this event</b>. You can add headings, lists and pictures with the buttons above the box. <b>Preview</b> shows how it will look.</li>
          <li>Leave <b>Let students sign up in advance</b> ticked if you want a list of who is coming. Set a <b>capacity</b> if places are limited.</li>
          <li>Tick <b>This event is a competition</b> if students compete. Choose individual, teams or houses.</li>
          <li>Press <b>Create event</b>. Students can see it straight away.</li>
        </ol>
        <p>When you change an event later, the button says <b>No changes to save</b> until you edit something, then <b>Save changes</b>, then <b>✓ Saved</b>. If you try to leave with changes that are not saved, you will be asked first.</p>
      </Topic>

      <Topic title="On the day: checking students in">
        <ul>
          <li><b>Show check-in QR</b> on the event page puts a big QR code on the projector. Students open the app, tap <b>Scan</b>, and point the camera at it (or use the phone camera). The code changes every few seconds, so a photo of it does not work later.</li>
          <li><b>Check-in is open from one hour before the event starts until it ends.</b> Before that, a student who scans is told when it opens. After it ends, they are told it has finished. The event page shows the current state.</li>
          <li><b>A student has no phone or forgot it:</b> on the event page, search their name under “Student has no phone?” and press <b>Check in</b>. You can also print the <b>sign-in sheet</b> and tick names on paper, or press <b>Scan student passes</b> and scan the pass QR code on a student's <b>Me</b> page.</li>
          <li><b>Checked in by mistake:</b> press <b>Undo</b> next to their name under “Checked in”.</li>
          <li>The <b>NFC tag / printable QR</b> at the bottom of the event page never changes. It follows the same time window.</li>
        </ul>
      </Topic>

      <Topic title="Exhibits and exhibitions">
        <ul>
          <li>An <b>exhibit</b> is one installation. An <b>exhibition</b> is a group of exhibits, such as the Physics Exhibition. Students see the exhibits grouped, with how many they have visited in each.</li>
          <li>Open an exhibit to <b>Edit</b> it, <b>Print QR sign</b>, or see how many students have visited. Editing never changes the QR code, so signs you have already printed keep working.</li>
          <li>Deleting an <b>exhibition</b> keeps its exhibits (they just stop being grouped). Deleting an <b>exhibit</b> removes it and its visits, and its printed QR code stops working.</li>
        </ul>
      </Topic>

      <Topic title="Competitions and results">
        <ul>
          <li>A competition belongs to an event: tick <b>This event is a competition</b> when you edit the event.</li>
          <li>Open <Link to="/admin/competitions" className="underline">Results</Link> to see who entered, in a table with one row per student. Type a <b>score</b> and a <b>rank</b> for each, and a status or note if you like.</li>
          <li><b>Fill ranks from scores</b> works the ranks out for you: the highest score is rank 1, and equal scores share a rank. You can still change any of them.</li>
          <li>Rows you have changed are highlighted. Press <b>Save</b> once at the bottom to store all of them. It then shows <b>✓ All saved</b>. If one row cannot be saved (a rank must be 1 or more), the others are still saved and that row stays marked so you can fix it.</li>
          <li>You can add a student by hand (for example one without a phone) with <b>Add a student by hand</b>.</li>
          <li>Results appear on the students' <b>Board</b>. For house competitions the four houses are ranked by their students' scores added up.</li>
        </ul>
      </Topic>

      <Topic title="Awards">
        <ul>
          <li>On <Link to="/admin/awards" className="underline">Awards</Link>, type the award, choose the students and write a reason if you want to. Nothing is calculated: you decide.</li>
          <li>New awards are <b>drafts</b>: only teachers can see them. Press <b>Publish</b> when you are ready. Each student then sees their award and your reason on their Home page.</li>
          <li>You can edit, hide or remove an award at any time.</li>
        </ul>
      </Topic>

      <Topic title="Common questions">
        <p><b>A student scanned and it says check-in isn't open yet.</b> That is the time window above. It also applies to the NFC tag and printed QR. To test earlier, you can edit the event's start time, or check someone in by hand.</p>
        <p><b>Can students see everything I type?</b> Only what you publish or save on an event or exhibit page. Award drafts and competition results you have not saved stay private.</p>
        <p><b>Are student names public?</b> Not by default. On public lists a student shows as “Student, 10A” unless they chose to show their name on their <b>Me</b> page.</p>
        <p><b>I deleted something by mistake.</b> Deleting cannot be undone from here. Ask an admin: the server keeps a nightly backup.</p>
        <p><b>Printed QR codes stopped working.</b> Tell an admin: this happens if the site's address or its secret setting was changed after printing.</p>
      </Topic>
    </div>
  );
}
