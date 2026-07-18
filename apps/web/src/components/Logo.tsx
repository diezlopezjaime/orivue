import { useState } from 'react';

export function Logo({ src, name }: { src?: string | null | undefined; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <span className="logo-fallback" aria-hidden="true">
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  return (
    <img
      className="channel-logo"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
