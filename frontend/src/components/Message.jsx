// A green / red / orange notice box. msg = { type: 'ok' | 'error' | 'info', text }
export default function Message({ msg }) {
  if (!msg) return null;
  return <div className={'msg ' + msg.type}>{msg.text}</div>;
}
