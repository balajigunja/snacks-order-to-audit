// Submitted -> Approved -> Invoiced -> Dispatched, as a small progress bar.
const STEPS = ['SUBMITTED', 'APPROVED', 'INVOICED', 'DISPATCHED'];
const LABEL = { SUBMITTED: 'Submitted', APPROVED: 'Approved', INVOICED: 'Invoiced', DISPATCHED: 'Dispatched' };

export default function StatusSteps({ status }) {
  if (status === 'CANCELLED') return <span className="chip red">Rejected</span>;
  const reached = STEPS.indexOf(status);
  return (
    <div className="steps">
      {STEPS.map((s, i) => (
        <div key={s} className={i <= reached ? 'step done' : 'step'}>{LABEL[s]}</div>
      ))}
    </div>
  );
}
