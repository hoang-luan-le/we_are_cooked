"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ComponentProps, useEffect, useRef } from "react";

const INTENT_MS = 200;
const started = new Set<string>();

/** A link that prefetches only after a sustained hover or keyboard focus. Clicking never waits for it. */
export function IntentLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string }) {
  const router = useRouter();
  const timer = useRef<number | undefined>(undefined);
  const cancel = () => window.clearTimeout(timer.current);
  const arm = () => {
    if (started.has(href)) return;
    cancel();
    timer.current = window.setTimeout(() => { started.add(href); router.prefetch(href); }, INTENT_MS);
  };
  useEffect(() => cancel, []);
  return <Link {...props} href={href} prefetch={false} onPointerEnter={arm} onPointerLeave={cancel} onFocus={arm} onBlur={cancel} />;
}
