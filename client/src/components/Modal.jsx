import { useEffect, useRef } from 'react';
// A pop-up window. Shown while open is true; Esc or the backdrop's close calls onClose.
export default function Modal({ open, onClose, children, className, style }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return <dialog ref={ref} className={className} style={style} onCancel={e => { e.preventDefault(); onClose && onClose(); }}>{open ? children : null}</dialog>;
}
