'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to capacity page on load
    router.push('/capacity');
  }, [router]);

  return (
    <main style={{ padding: "2rem" }}>
      <p>Redirecting to capacity dashboard...</p>
    </main>
  );
}