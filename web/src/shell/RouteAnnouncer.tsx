import { useEffect, useRef, useState } from 'react';

export function RouteAnnouncer({ title }: { title: string }) {
  const [text, setText] = useState('');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setText(title);
  }, [title]);
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {text}
    </p>
  );
}
