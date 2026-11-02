// Green (or red when err) message strip under a panel title. msg = { text, err } or null.
export default function Msg({ msg }) {
  if (!msg) return null;
  return <div className={'msg' + (msg.err ? ' err' : '')} role="status">{msg.text}</div>;
}
