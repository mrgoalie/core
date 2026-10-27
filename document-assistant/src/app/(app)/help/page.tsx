import { getDb } from "@/server/db/client";
import { getPublishedUi } from "@/server/services/ui";

export default async function HelpPage() {
  const ui = await getPublishedUi(await getDb());
  return (
    <div className="page page-narrow stack">
      <h1>Help</h1>
      <div className="card stack">
        <h2>How it works</h2>
        <ol style={{ paddingLeft: 22, margin: 0 }} className="stack">
          <li><strong>Choose a task</strong> on the home screen.</li>
          <li><strong>Select the case.</strong> You&apos;ll only see cases you have access to.</li>
          <li><strong>Review the information.</strong> Check the documents we found, add anything missing, and correct anything that looks wrong. Your work saves automatically.</li>
          <li><strong>Create the draft.</strong> Read it, look at the list of things that need attention, and fix what you can.</li>
          <li><strong>Send it to an attorney.</strong> Nothing leaves the firm until an attorney approves it.</li>
        </ol>
      </div>
      <div className="card stack">
        <h2>Important</h2>
        <p>Everything this tool creates is a <strong>draft</strong> until an attorney approves it. It never sends, files or emails anything.</p>
        <p>If the draft says something you can&apos;t find in the records, flag it for the attorney — don&apos;t guess.</p>
        <p style={{ margin: 0 }}>{ui.home.helpText}</p>
      </div>
    </div>
  );
}
