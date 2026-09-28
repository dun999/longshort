import { Suspense } from 'react';
import { Lobby } from '@/components/lobby/Lobby';

export default function Page() {
  return (
    <Suspense>
      <Lobby />
    </Suspense>
  );
}
